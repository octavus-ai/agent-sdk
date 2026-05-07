import {
  createInternalErrorEvent,
  type DynamicTool,
  type InlineMcpServer,
  type StreamEvent,
  type ToolHandlers,
  type ToolProvider,
  type ToolResult,
  type ToolSchema,
} from '@octavus/core';
import type { ApiClientConfig } from '@/base-api-client.js';
import type { Resource } from '@/resource.js';
import { executeStream } from '@/streaming.js';
import { resolveMcpServers } from '@/resolve-mcp-servers.js';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new trigger execution */
export interface TriggerRequest {
  type: 'trigger';
  triggerName: string;
  input?: Record<string, unknown>;
  /** ID of the last message to keep. Messages after this are removed before execution. `null` = truncate all. */
  rollbackAfterMessageId?: string | null;
}

/** Continue execution after client-side tool handling */
export interface ContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}

/** All request types supported by the session */
export type SessionRequest = TriggerRequest | ContinueRequest;

/** Stop message to abort in-flight requests */
export interface StopMessage {
  type: 'stop';
}

/** All socket protocol messages (trigger, continue, stop) */
export type SocketMessage = TriggerRequest | ContinueRequest | StopMessage;

// =============================================================================
// Socket Message Handler Types
// =============================================================================

/** Handlers for socket message streaming */
export interface SocketMessageHandlers {
  /** Called for each stream event */
  onEvent: (event: StreamEvent) => void;
  /** Called after streaming completes (not called if aborted) */
  onFinish?: () => void | Promise<void>;
}

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Converts an async iterable of stream events to an SSE-formatted ReadableStream.
 * Use this when you need to return an SSE response (e.g., HTTP endpoints).
 *
 * @example
 * ```typescript
 * const events = session.trigger('user-message', input);
 * return new Response(toSSEStream(events), {
 *   headers: { 'Content-Type': 'text/event-stream' },
 * });
 * ```
 */
export function toSSEStream(events: AsyncIterable<StreamEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatBytes = encoder.encode(': heartbeat\n\n');

  return new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(heartbeatBytes);
        } catch {
          clearInterval(heartbeat);
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);

      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        const errorEvent = createInternalErrorEvent(
          err instanceof Error ? err.message : 'Unknown error',
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
        controller.close();
      } finally {
        clearInterval(heartbeat);
      }
    },
  });
}

function resolveDynamicTools(provider: ToolProvider): DynamicTool[] {
  const handlers = provider.toolHandlers();
  return provider
    .toolSchemas()
    .filter((s) => handlers[s.name])
    .map((s) => ({ schema: s, handler: handlers[s.name]! }));
}

export interface SessionConfig {
  sessionId: string;
  config: ApiClientConfig;
  tools?: ToolHandlers;
  resources?: Resource[];
  /** Inline MCP servers providing namespaced, typed tool groups */
  mcpServers?: InlineMcpServer[];
  /** Called after server-side tools execute, before yielding events or continuing. Use to normalize tool results (e.g., upload base64 images). */
  onToolResults?: (results: ToolResult[]) => Promise<void>;
  /** When true, unhandled tool calls return errors instead of being emitted as client-tool-request events. */
  rejectClientToolCalls?: boolean;
}

/**
 * Options for trigger execution.
 */
export interface TriggerOptions {
  /** Abort signal to cancel the trigger execution */
  signal?: AbortSignal;
}

/** Handles streaming and tool continuation for agent sessions */
export class AgentSession {
  private sessionId: string;
  private config: ApiClientConfig;
  /**
   * Stable handlers from construction (static tools + MCP-namespaced tools).
   * `setDynamicTools` rebuilds {@link toolHandlers} from this snapshot every
   * call, so dynamic tools never permanently shadow MCP/static handlers.
   */
  private baseHandlers: ToolHandlers;
  /** Active handler set: {@link baseHandlers} merged with the latest dynamic tools (which override on name collision). */
  private toolHandlers: ToolHandlers;
  private resourceMap: Map<string, Resource>;
  /** Schemas from inline MCP servers passed at construction. Stable for the session's lifetime. */
  private mcpToolSchemas: ToolSchema[] = [];
  /** Schemas registered via {@link setDynamicTools}. Mutable across the session. */
  private dynamicToolSchemas: ToolSchema[] | undefined;
  private socketAbortController: AbortController | null = null;
  private onToolResults?: (results: ToolResult[]) => Promise<void>;
  private rejectClientToolCalls: boolean;

  constructor(sessionConfig: SessionConfig) {
    this.sessionId = sessionConfig.sessionId;
    this.config = sessionConfig.config;
    this.onToolResults = sessionConfig.onToolResults;
    this.rejectClientToolCalls = sessionConfig.rejectClientToolCalls ?? false;
    this.resourceMap = new Map();

    if (sessionConfig.mcpServers !== undefined && sessionConfig.mcpServers.length > 0) {
      const resolved = resolveMcpServers(sessionConfig.mcpServers, sessionConfig.tools);
      this.baseHandlers = resolved.toolHandlers;
      this.mcpToolSchemas = resolved.dynamicToolSchemas;
    } else {
      this.baseHandlers = sessionConfig.tools ?? {};
    }
    this.toolHandlers = { ...this.baseHandlers };

    for (const resource of sessionConfig.resources ?? []) {
      this.resourceMap.set(resource.name, resource);
    }
  }

  /**
   * Execute a session request and stream the response.
   *
   * This is the unified method that handles both triggers and continuations.
   * Use this when you want to pass through requests from the client directly.
   *
   * @param request - The request (check `request.type` for the kind)
   * @param options - Optional configuration including abort signal
   *
   * @example HTTP route (simple passthrough)
   * ```typescript
   * const events = session.execute(body, { signal: request.signal });
   * return new Response(toSSEStream(events));
   * ```
   *
   * @example WebSocket handler
   * ```typescript
   * socket.on('message', (data) => {
   *   const events = session.execute(data);
   *   for await (const event of events) {
   *     socket.send(JSON.stringify(event));
   *   }
   * });
   * ```
   */
  async *execute(request: SessionRequest, options?: TriggerOptions): AsyncGenerator<StreamEvent> {
    if (request.type === 'continue') {
      yield* this.executeStream(
        { executionId: request.executionId, toolResults: request.toolResults },
        options?.signal,
      );
    } else {
      yield* this.executeStream(
        {
          triggerName: request.triggerName,
          input: request.input,
          rollbackAfterMessageId: request.rollbackAfterMessageId,
        },
        options?.signal,
      );
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set the full list of dynamic tools (schemas + handlers).
   * Replaces any previously set dynamic tools - removed tools are
   * unregistered, new ones are added, and updated schemas are sent
   * to the platform on the next request.
   *
   * Accepts either a `ToolProvider` (e.g. `Computer`) or an explicit
   * `DynamicTool[]` array.
   *
   * Safe to call mid-session: executeStream resolves toolHandlers via
   * a getter on each continuation loop, so new handlers are visible
   * immediately.
   *
   * Inline MCP servers passed via `SessionConfig.mcpServers` and the
   * `tools` from `attach()` are stored as a stable base and re-applied
   * on every call, so they survive across `setDynamicTools` invocations.
   * If a dynamic tool name collides with a base handler, the dynamic
   * handler wins for the duration of the current dynamic-tool set; the
   * base handler is restored on the next `setDynamicTools` call that
   * doesn't re-register the same name.
   */
  setDynamicTools(source: ToolProvider | DynamicTool[]): void {
    const tools = Array.isArray(source) ? source : resolveDynamicTools(source);

    const next: ToolHandlers = { ...this.baseHandlers };
    for (const tool of tools) {
      next[tool.schema.name] = tool.handler;
    }

    this.toolHandlers = next;
    this.dynamicToolSchemas = tools.map((t) => t.schema);
  }

  /**
   * Handle a WebSocket protocol message (trigger, continue, or stop).
   * Manages abort controller lifecycle internally.
   *
   * @example
   * ```typescript
   * conn.on('data', (raw) => {
   *   session.handleSocketMessage(JSON.parse(raw), {
   *     onEvent: (event) => conn.write(JSON.stringify(event)),
   *     onFinish: async () => {
   *       // Fetch messages and persist to your database for restoration
   *     },
   *   });
   * });
   * ```
   */
  async handleSocketMessage(
    message: SocketMessage,
    handlers: SocketMessageHandlers,
  ): Promise<void> {
    if (message.type === 'stop') {
      this.socketAbortController?.abort();
      return;
    }

    this.socketAbortController?.abort();
    this.socketAbortController = new AbortController();

    const localController = this.socketAbortController;

    try {
      const events = this.execute(message, { signal: localController.signal });

      for await (const event of events) {
        if (localController.signal.aborted) break;
        handlers.onEvent(event);
      }

      if (!localController.signal.aborted && handlers.onFinish) {
        await handlers.onFinish();
      }
    } catch (err) {
      if (!localController.signal.aborted) {
        const errorEvent = createInternalErrorEvent(
          err instanceof Error ? err.message : 'Unknown error',
        );
        handlers.onEvent(errorEvent);
      }
    }
  }

  private async *executeStream(
    payload: {
      triggerName?: string;
      input?: Record<string, unknown>;
      executionId?: string;
      toolResults?: ToolResult[];
      rollbackAfterMessageId?: string | null;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    yield* executeStream(
      {
        config: this.config,
        getToolHandlers: () => this.toolHandlers,
        url: `${this.config.baseUrl}/api/agent-sessions/${this.sessionId}/trigger`,
        buildBody: ({ executionId, toolResults }) => {
          const body: Record<string, unknown> = {};
          if (payload.triggerName !== undefined) body.triggerName = payload.triggerName;
          if (payload.input !== undefined) body.input = payload.input;
          if (payload.rollbackAfterMessageId !== undefined)
            body.rollbackAfterMessageId = payload.rollbackAfterMessageId;
          if (executionId !== undefined) body.executionId = executionId;
          if (toolResults !== undefined) body.toolResults = toolResults;
          const allDynamicSchemas = this.collectDynamicSchemas();
          if (allDynamicSchemas !== undefined) {
            body.dynamicToolSchemas = allDynamicSchemas;
          }
          return body;
        },
        onResourceUpdate: (name, value) => this.handleResourceUpdate(name, value),
        onToolResults: this.onToolResults,
        rejectClientToolCalls: this.rejectClientToolCalls,
        errorContext: 'Failed to trigger',
      },
      { executionId: payload.executionId, toolResults: payload.toolResults },
      signal,
    );
  }

  private handleResourceUpdate(name: string, value: unknown): void {
    const resource = this.resourceMap.get(name);
    if (resource) {
      void resource.onUpdate(value);
    }
  }

  /**
   * Merge MCP-registered schemas with `setDynamicTools`-managed schemas for
   * the wire request. Returns undefined when no MCP schemas are present and
   * no dynamic schemas have been set, so the field is omitted from the body.
   */
  private collectDynamicSchemas(): ToolSchema[] | undefined {
    if (this.mcpToolSchemas.length === 0) return this.dynamicToolSchemas;
    return [...this.mcpToolSchemas, ...(this.dynamicToolSchemas ?? [])];
  }
}
