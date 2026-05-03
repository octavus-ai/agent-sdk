import type { ChildProcess } from 'node:child_process';
import type {
  ToolHandler,
  ToolSchema,
  DeviceProvider,
  DynamicMcpProvider,
  ComputerHealth,
  EnsureReadyResult,
  EntryHealth,
} from '@octavus/core';
import {
  type McpEntry,
  type McpDiagnostics,
  type StdioConfig,
  type HttpConfig,
  type ShellConfig,
  type ShellMode,
  NAMESPACE_SEPARATOR,
  createStdioConfig,
  createHttpConfig,
  createShellConfig,
} from './entries';
import { connectStdio, connectHttp, type McpConnection } from './mcp-client';
import { createShellTools } from './shell';
import { createStatusTool, type EntryStatus } from './status-tool';
import { launchChrome, type ChromeInstance, type ChromeLaunchOptions } from './chrome';

export type { ChromeInstance, ChromeLaunchOptions };
export type { ComputerHealth, EnsureReadyResult, EntryHealth };

const HEALTH_PROBE_TIMEOUT_MS = 3_000;

interface ManagedProcess {
  process: ChildProcess;
}

export interface ComputerConfig {
  mcpServers: Record<string, McpEntry>;
  managedProcesses?: ManagedProcess[];
  diagnostics?: Record<string, McpDiagnostics>;
  /** Namespaces to skip during start() - they begin as degraded and can be connected on demand via restartEntry(). */
  deferredEntries?: string[];
}

interface EntryState {
  namespace: string;
  handlers: Record<string, ToolHandler>;
  schemas: ToolSchema[];
  connection?: McpConnection;
  status: EntryStatus;
  error?: string;
}

export class Computer implements DeviceProvider, DynamicMcpProvider {
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

    const deferred = new Set(this.config.deferredEntries ?? []);
    for (const namespace of deferred) {
      this.setDegradedEntry(namespace, 'Deferred - connect via restartEntry()');
    }

    const entries = Object.entries(this.config.mcpServers).filter(
      ([namespace]) => !deferred.has(namespace),
    );
    const results = await Promise.allSettled(
      entries.map(([namespace, entry]) => this.connectEntry(namespace, entry)),
    );

    const errors: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        const namespace = entries[i]![0];
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${namespace}: ${errorMessage}`);
        this.setDegradedEntry(namespace, errorMessage);
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
            // Ignore close errors - the process may already be gone
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
  // Recovery
  // ---------------------------------------------------------------------------

  async retryDegraded(): Promise<{ recovered: string[]; stillDegraded: string[] }> {
    const recovered: string[] = [];
    const stillDegraded: string[] = [];

    const degraded = [...this.entries.values()].filter((e) => e.status === 'degraded');
    if (degraded.length === 0) return { recovered, stillDegraded };

    const results = await Promise.allSettled(
      degraded.map(async (entry) => {
        if (entry.connection) {
          await entry.connection.close().catch(() => {});
        }
        await this.connectEntry(entry.namespace, this.config.mcpServers[entry.namespace]!);
        return entry.namespace;
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const namespace = degraded[i]!.namespace;

      if (result.status === 'fulfilled') {
        recovered.push(namespace);
      } else {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.setDegradedEntry(namespace, errorMessage);
        stillDegraded.push(namespace);
      }
    }

    return { recovered, stillDegraded };
  }

  /** Stop a specific MCP entry, closing its connection and marking it as degraded. */
  async stopEntry(namespace: string): Promise<void> {
    const existing = this.entries.get(namespace);
    if (existing?.connection) {
      await existing.connection.close().catch(() => {});
    }
    this.setDegradedEntry(namespace, 'Entry stopped');
  }

  /** Whether an MCP entry has been registered for the given namespace. */
  hasEntry(namespace: string): boolean {
    return this.config.mcpServers[namespace] !== undefined;
  }

  /**
   * Add a new MCP entry to a running Computer.
   * When `deferred` is false (default), connects immediately.
   * When `deferred` is true, registers as degraded (agent calls `restartEntry` to connect).
   * Throws if the namespace already exists - call `removeEntry` first to replace.
   */
  async addEntry(
    namespace: string,
    entry: McpEntry,
    options?: { deferred?: boolean },
  ): Promise<void> {
    if (this.config.mcpServers[namespace]) {
      throw new Error(
        `MCP entry "${namespace}" already exists. Call removeEntry first to replace.`,
      );
    }

    this.config.mcpServers[namespace] = entry;

    if (options?.deferred) {
      this.setDegradedEntry(namespace, 'Deferred - connect via restartEntry()');
    } else {
      try {
        await this.connectEntry(namespace, entry);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.setDegradedEntry(namespace, errorMessage);
      }
    }
  }

  /** Stop and remove an MCP entry. No-op if the namespace doesn't exist. */
  async removeEntry(namespace: string): Promise<void> {
    const existing = this.entries.get(namespace);
    if (existing?.connection) {
      await existing.connection.close().catch(() => {});
    }
    this.entries.delete(namespace);
    const { [namespace]: _, ...rest } = this.config.mcpServers;
    this.config.mcpServers = rest;
  }

  /** Restart a specific MCP entry by closing its connection and reconnecting. */
  async restartEntry(namespace: string): Promise<void> {
    const config = this.config.mcpServers[namespace];
    if (!config) return;

    const existing = this.entries.get(namespace);
    if (existing?.connection) {
      await existing.connection.close().catch(() => {});
    }

    try {
      await this.connectEntry(namespace, config);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.setDegradedEntry(namespace, errorMessage);
    }
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async getHealth(): Promise<ComputerHealth> {
    const probes = [...this.entries.values()].map((entry) => this.probeEntry(entry));
    const entries = await Promise.all(probes);
    const healthy = entries.length > 0 && entries.every((e) => e.healthy);
    return { healthy, entries, totalTools: this.toolSchemas().length };
  }

  async ensureReady(): Promise<EnsureReadyResult> {
    const health = await this.getHealth();
    if (health.healthy) return health;

    const unhealthy = health.entries.filter((e) => !e.healthy);
    await Promise.allSettled(unhealthy.map((entry) => this.restartEntry(entry.name)));

    const newHealth = await this.getHealth();
    const recovered: string[] = [];
    const failedEntries: string[] = [];

    for (const entry of unhealthy) {
      const updated = newHealth.entries.find((e) => e.name === entry.name);
      if (updated?.healthy) {
        recovered.push(entry.name);
      } else {
        failedEntries.push(entry.name);
      }
    }

    return { ...newHealth, recovered, failedEntries };
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

  private async probeEntry(entry: EntryState): Promise<EntryHealth> {
    if (entry.status === 'degraded') {
      return { name: entry.namespace, healthy: false, error: entry.error };
    }

    if (!entry.connection) {
      return { name: entry.namespace, healthy: true };
    }

    try {
      await Promise.race([
        entry.connection.ping(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Health probe timed out')), HEALTH_PROBE_TIMEOUT_MS);
        }),
      ]);
      return { name: entry.namespace, healthy: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { name: entry.namespace, healthy: false, error };
    }
  }

  private setDegradedEntry(namespace: string, error: string): void {
    const diagnostics = this.config.diagnostics?.[namespace];
    const statusTool = createStatusTool(namespace, 'degraded', [], error, diagnostics);
    this.entries.set(namespace, {
      namespace,
      handlers: { [statusTool.schema.name]: statusTool.handler },
      schemas: [statusTool.schema],
      status: 'degraded',
      error,
    });
  }

  private async connectEntry(namespace: string, entry: McpEntry): Promise<void> {
    if (entry.type === 'shell') {
      const shell = createShellTools(namespace, entry);
      const toolNames = shell.schemas.map((s) => s.name.split(NAMESPACE_SEPARATOR)[1]!);
      const statusTool = createStatusTool(namespace, 'connected', toolNames);
      this.entries.set(namespace, {
        namespace,
        handlers: { ...shell.handlers, [statusTool.schema.name]: statusTool.handler },
        schemas: [...shell.schemas, statusTool.schema],
        status: 'connected',
      });
      return;
    }

    const connection =
      entry.type === 'stdio'
        ? await connectStdio(namespace, entry)
        : await connectHttp(namespace, entry);

    const toolNames = connection.schemas.map((s) => s.name.split(NAMESPACE_SEPARATOR)[1]!);
    const statusTool = createStatusTool(namespace, 'connected', toolNames);

    this.entries.set(namespace, {
      namespace,
      handlers: { ...connection.handlers, [statusTool.schema.name]: statusTool.handler },
      schemas: [...connection.schemas, statusTool.schema],
      connection,
      status: 'connected',
    });
  }
}
