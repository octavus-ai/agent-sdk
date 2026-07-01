import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { ToolHandler, ToolSchema } from '@octavus/core';
import { NAMESPACE_SEPARATOR, type ShellConfig, type ShellMode } from './entries';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_LENGTH = 100_000;

interface ShellToolState {
  handlers: Record<string, ToolHandler>;
  schemas: ToolSchema[];
}

function getLoginShell(): { shell: string; args: string[] } {
  const os = platform();
  if (os === 'win32') {
    return { shell: 'cmd.exe', args: ['/c'] };
  }
  const userShell = process.env.SHELL ?? '/bin/bash';
  return { shell: userShell, args: ['-l', '-c'] };
}

function isCommandAllowed(command: string, mode: ShellMode): boolean {
  if (mode === 'unrestricted') return true;

  if (mode.blockedPatterns) {
    for (const pattern of mode.blockedPatterns) {
      if (pattern.test(command)) return false;
    }
  }

  if (mode.allowedPatterns) {
    for (const pattern of mode.allowedPatterns) {
      if (pattern.test(command)) return true;
    }
    return false;
  }

  return true;
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
  return (
    output.slice(0, half) +
    `\n\n... truncated ${output.length - MAX_OUTPUT_LENGTH} characters ...\n\n` +
    output.slice(-half)
  );
}

// Resolves when the spawned shell *exits* (not when all inherited pipes close).
// This matters for commands like `A && nohup B & echo $!` where bash forks a
// subshell that inherits our stdout/stderr. Waiting on `close` would block for
// the full lifetime of B. We resolve on `exit` and destroy the read streams so
// grandchildren's writes no longer hold us open.
function executeCommand(
  command: string,
  cwd: string | undefined,
  timeout: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { shell, args } = getLoginShell();
    const isWindows = platform() === 'win32';
    const child = spawn(shell, [...args, command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: detach into a new process group so the whole tree (subshells,
      // nohup'd jobs sharing the pgroup) can be signalled via the negative-pid
      // group kill below. Windows: do NOT detach - a detached cmd.exe gets its own
      // console and a child's stdout stops reaching our pipe, so `python -c ...`
      // (and even `python --version`) come back with an empty stdout. windowsHide
      // suppresses the console window; the tree is killed with taskkill on timeout.
      detached: !isWindows,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // Wrapped in an object so `settle` can reference it via closure and
    // setTimeout can assign it after `settle` is defined. A bare `let timer`
    // trips prefer-const (it's only assigned once); a `const timer` defined
    // after `settle` trips no-use-before-define.
    const timerRef: { handle?: ReturnType<typeof setTimeout> } = {};

    const settle = (result: { exitCode: number; stdout: string; stderr: string }): void => {
      if (settled) return;
      settled = true;
      if (timerRef.handle !== undefined) clearTimeout(timerRef.handle);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };

    timerRef.handle = setTimeout(() => {
      // Kill the whole process tree so grandchildren (subshells, nohup'd jobs, the
      // command running under cmd.exe) die too - the built-in spawn `timeout` only
      // reaches the shell itself. The negative-pid group kill is POSIX-only; on
      // Windows there is no process group to signal, so walk the tree with taskkill.
      if (child.pid !== undefined) {
        try {
          if (isWindows) {
            // A spawn failure arrives as an async 'error' event that crashes the
            // process if unhandled; taskkill always exists on Windows, but guard anyway.
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']).on('error', () => {});
          } else {
            process.kill(-child.pid, 'SIGKILL');
          }
        } catch {
          // Tree may already be gone.
        }
      }
      settle({
        exitCode: 124,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr + '\n[command timed out]'),
      });
    }, timeout);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      settle({
        exitCode: 1,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(error.message),
      });
    });

    child.on('exit', (code, signal) => {
      settle({
        exitCode: code ?? (signal ? 1 : -1),
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
      });
    });
  });
}

export function createShellTools(namespace: string, config: ShellConfig): ShellToolState {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;

  const runCommandHandler: ToolHandler = async (args: Record<string, unknown>) => {
    const command = args.command as string | undefined;
    if (!command) {
      return { error: 'command is required' };
    }

    if (!isCommandAllowed(command, config.mode)) {
      return { error: `Command not allowed by safety policy: ${command}` };
    }

    const cwd = (args.cwd as string | undefined) ?? config.cwd;
    const commandTimeout = (args.timeout as number | undefined) ?? timeout;

    return await executeCommand(command, cwd, commandTimeout);
  };

  const nsName = `${namespace}${NAMESPACE_SEPARATOR}run_command`;

  return {
    handlers: { [nsName]: runCommandHandler },
    schemas: [
      {
        name: nsName,
        description:
          "Run a shell command on the local machine. Commands execute in a login shell with the user's full environment.",
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            cwd: {
              type: 'string',
              description: 'Working directory (optional, defaults to configured directory)',
            },
            timeout: {
              type: 'number',
              description: `Timeout in milliseconds (optional, default ${DEFAULT_TIMEOUT_MS})`,
            },
          },
          required: ['command'],
        },
      },
    ],
  };
}
