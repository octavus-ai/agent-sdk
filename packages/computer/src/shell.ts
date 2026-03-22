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
      timeout,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(error.message),
      });
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
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
