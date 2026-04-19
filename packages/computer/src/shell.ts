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
    const child = spawn(shell, [...args, command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
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
      // Kill the whole process group so grandchildren (subshells, nohup'd jobs
      // sharing the pgroup) die too. The built-in spawn `timeout` only reaches
      // bash itself, which is why we manage it here.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Group may already be gone.
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
