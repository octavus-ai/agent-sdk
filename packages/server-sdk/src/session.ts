import {
  createInternalErrorEvent,
  type StreamEvent,
  type ToolHandlers,
  type ToolResult,
} from '@octavus/core';
import type { ApiClientConfig } from '@/base-api-client.js';
import type { Resource } from '@/resource.js';
import { executeStream } from '@/streaming.js';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new trigger execution */
export interface TriggerRequest {
  type: 'trigger';
  triggerName: string;
  input?: Record<string, unknown>;
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

  return new ReadableStream({
    async start(controller) {
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
      }
    },
  });
}

export interface SessionConfig {
  sessionId: string;
  config: ApiClientConfig;
  tools?: ToolHandlers;
  resources?: Resource[];
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
  private toolHandlers: ToolHandlers;
  private resourceMap: Map<string, Resource>;
  private socketAbortController: AbortController | null = null;

  constructor(sessionConfig: SessionConfig) {
    this.sessionId = sessionConfig.sessionId;
    this.config = sessionConfig.config;
    this.toolHandlers = sessionConfig.tools ?? {};
    this.resourceMap = new Map();

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
        { triggerName: request.triggerName, input: request.input },
        options?.signal,
      );
    }
  }

  getSessionId(): string {
    return this.sessionId;
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
   *     onFinish: () => sendMessagesUpdate(),
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
    },
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    yield* executeStream(
      {
        config: this.config,
        toolHandlers: this.toolHandlers,
        url: `${this.config.baseUrl}/api/agent-sessions/${this.sessionId}/trigger`,
        buildBody: ({ executionId, toolResults }) => {
          const body: Record<string, unknown> = {};
          if (payload.triggerName !== undefined) body.triggerName = payload.triggerName;
          if (payload.input !== undefined) body.input = payload.input;
          if (executionId !== undefined) body.executionId = executionId;
          if (toolResults !== undefined) body.toolResults = toolResults;
          return body;
        },
        onResourceUpdate: (name, value) => this.handleResourceUpdate(name, value),
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
}
