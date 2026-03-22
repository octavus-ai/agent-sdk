/** Stdio transport — spawns an MCP server as a child process, communicates via stdin/stdout. */
export interface StdioConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** HTTP transport — connects to an MCP server over Streamable HTTP. */
export interface HttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type ShellMode = 'unrestricted' | { allowedPatterns?: RegExp[]; blockedPatterns?: RegExp[] };

/** Built-in shell — executes commands directly via child_process (no MCP subprocess). */
export interface ShellConfig {
  type: 'shell';
  cwd?: string;
  mode: ShellMode;
  timeout?: number;
}

export type McpEntry = StdioConfig | HttpConfig | ShellConfig;

export const NAMESPACE_SEPARATOR = '__';

export function createStdioConfig(
  command: string,
  args?: string[],
  options?: { env?: Record<string, string>; cwd?: string },
): StdioConfig {
  return { type: 'stdio', command, args, ...options };
}

export function createHttpConfig(
  url: string,
  options?: { headers?: Record<string, string> },
): HttpConfig {
  return { type: 'http', url, ...options };
}

export function createShellConfig(options: Omit<ShellConfig, 'type'>): ShellConfig {
  return { type: 'shell', ...options };
}
