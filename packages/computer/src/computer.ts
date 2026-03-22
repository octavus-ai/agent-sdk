import type { ChildProcess } from 'node:child_process';
import type { ToolHandler, ToolProvider, ToolSchema } from '@octavus/core';
import {
  type McpEntry,
  type StdioConfig,
  type HttpConfig,
  type ShellConfig,
  type ShellMode,
  createStdioConfig,
  createHttpConfig,
  createShellConfig,
} from './entries';
import { connectStdio, connectHttp, type McpConnection } from './mcp-client';
import { createShellTools } from './shell';
import { launchChrome, type ChromeInstance, type ChromeLaunchOptions } from './chrome';

export type { ChromeInstance, ChromeLaunchOptions };

interface ManagedProcess {
  process: ChildProcess;
}

export interface ComputerConfig {
  mcpServers: Record<string, McpEntry>;
  managedProcesses?: ManagedProcess[];
}

interface EntryState {
  namespace: string;
  handlers: Record<string, ToolHandler>;
  schemas: ToolSchema[];
  connection?: McpConnection;
}

export class Computer implements ToolProvider {
  private config: ComputerConfig;
  private entries = new Map<string, EntryState>();
  private started = false;

  constructor(config: ComputerConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  static stdio(
    command: string,
    args?: string[],
    options?: { env?: Record<string, string>; cwd?: string },
  ): StdioConfig {
    return createStdioConfig(command, args, options);
  }

  static http(url: string, options?: { headers?: Record<string, string> }): HttpConfig {
    return createHttpConfig(url, options);
  }

  static shell(options: { cwd?: string; mode: ShellMode; timeout?: number }): ShellConfig {
    return createShellConfig(options);
  }

  static launchChrome(options: ChromeLaunchOptions): Promise<ChromeInstance> {
    return launchChrome(options);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<{ errors: string[] }> {
    if (this.started) return { errors: [] };

    const entries = Object.entries(this.config.mcpServers);
    const results = await Promise.allSettled(
      entries.map(([namespace, entry]) => this.connectEntry(namespace, entry)),
    );

    const errors: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        const namespace = entries[i]![0];
        errors.push(
          `${namespace}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }

    if (errors.length > 0 && errors.length === entries.length) {
      throw new Error(`All MCP connections failed:\n${errors.join('\n')}`);
    }

    this.started = true;
    return { errors };
  }

  async stop(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const state of this.entries.values()) {
      if (state.connection) {
        closePromises.push(
          state.connection.close().catch(() => {
            // Ignore close errors — the process may already be gone
          }),
        );
      }
    }

    await Promise.allSettled(closePromises);

    if (this.config.managedProcesses) {
      for (const managed of this.config.managedProcesses) {
        try {
          managed.process.kill();
        } catch {
          // Process may already be dead
        }
      }
    }

    this.entries.clear();
    this.started = false;
  }

  // ---------------------------------------------------------------------------
  // ToolProvider
  // ---------------------------------------------------------------------------

  toolHandlers(): Record<string, ToolHandler> {
    const merged: Record<string, ToolHandler> = {};
    for (const state of this.entries.values()) {
      Object.assign(merged, state.handlers);
    }
    return merged;
  }

  toolSchemas(): ToolSchema[] {
    const all: ToolSchema[] = [];
    for (const state of this.entries.values()) {
      all.push(...state.schemas);
    }
    return all;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async connectEntry(namespace: string, entry: McpEntry): Promise<void> {
    if (entry.type === 'shell') {
      const shell = createShellTools(namespace, entry);
      this.entries.set(namespace, {
        namespace,
        handlers: shell.handlers,
        schemas: shell.schemas,
      });
      return;
    }

    const connection =
      entry.type === 'stdio'
        ? await connectStdio(namespace, entry)
        : await connectHttp(namespace, entry);

    this.entries.set(namespace, {
      namespace,
      handlers: connection.handlers,
      schemas: connection.schemas,
      connection,
    });
  }
}
