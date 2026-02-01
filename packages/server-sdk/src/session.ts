import {
  safeParseStreamEvent,
  isAbortError,
  createInternalErrorEvent,
  createApiErrorEvent,
  type StreamEvent,
  type ToolHandlers,
  type PendingToolCall,
  type ToolResult,
} from '@octavus/core';
import { parseApiError } from '@/api-error.js';
import type { ApiClientConfig } from '@/base-api-client.js';
import type { Resource } from '@/resource.js';

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

    // Index resources by name for fast lookup
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

    // Abort any previous request before starting new one
    this.socketAbortController?.abort();
    this.socketAbortController = new AbortController();

    // Capture local reference - controller might change if another request comes in
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
    let toolResults = payload.toolResults;
    let executionId = payload.executionId;
    let continueLoop = true;

    while (continueLoop) {
      // Check if aborted before making request
      if (signal?.aborted) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }

      // Build request body - only include defined fields
      const body: Record<string, unknown> = {};
      if (payload.triggerName !== undefined) body.triggerName = payload.triggerName;
      if (payload.input !== undefined) body.input = payload.input;
      if (executionId !== undefined) body.executionId = executionId;
      if (toolResults !== undefined) body.toolResults = toolResults;

      // Make request to platform
      let response: Response;
      try {
        response = await fetch(
          `${this.config.baseUrl}/api/agent-sessions/${this.sessionId}/trigger`,
          {
            method: 'POST',
            headers: this.config.getHeaders(),
            body: JSON.stringify(body),
            signal,
          },
        );
      } catch (err) {
        // Handle abort errors gracefully
        if (isAbortError(err)) {
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }
        throw err;
      }

      if (!response.ok) {
        const { message } = await parseApiError(response, 'Failed to trigger');
        yield createApiErrorEvent(response.status, message);
        return;
      }

      if (!response.body) {
        yield createInternalErrorEvent('Response body is not readable');
        return;
      }

      // Reset tool results for next iteration (executionId persists through the loop)
      toolResults = undefined;

      // Read and process the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pendingToolCalls: PendingToolCall[] | null = null;

      // Read stream until done
      let streamDone = false;
      while (!streamDone) {
        // Check if aborted during stream reading
        if (signal?.aborted) {
          reader.releaseLock();
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }

        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (err) {
          // Handle abort errors gracefully during read
          if (isAbortError(err)) {
            reader.releaseLock();
            yield { type: 'finish', finishReason: 'stop' };
            return;
          }
          throw err;
        }

        const { done, value } = readResult;

        if (done) {
          streamDone = true;
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const parsed = safeParseStreamEvent(JSON.parse(line.slice(6)));
              if (!parsed.success) {
                // Skip malformed events
                continue;
              }
              const event = parsed.data;

              // Capture executionId from start event
              if (event.type === 'start' && event.executionId) {
                executionId = event.executionId;
              }

              // Handle tool-request - split into server and client tools
              if (event.type === 'tool-request') {
                pendingToolCalls = event.toolCalls;
                // Don't forward tool-request to consumer
                continue;
              }

              if (event.type === 'finish') {
                if (event.finishReason === 'tool-calls' && pendingToolCalls) {
                  continue;
                }
                yield event;
                continueLoop = false;
                continue;
              }

              if (event.type === 'resource-update') {
                this.handleResourceUpdate(event.name, event.value);
              }

              yield event;
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Check if aborted before tool execution
      if (signal?.aborted) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }

      // If we have pending tool calls, split into server and client tools
      if (pendingToolCalls && pendingToolCalls.length > 0) {
        const serverTools = pendingToolCalls.filter((tc) => this.toolHandlers[tc.toolName]);
        const clientTools = pendingToolCalls.filter((tc) => !this.toolHandlers[tc.toolName]);

        const serverResults = await Promise.all(
          serverTools.map(async (tc): Promise<ToolResult> => {
            // Handler is guaranteed to exist since we filtered by handler presence
            const handler = this.toolHandlers[tc.toolName]!;
            try {
              const result = await handler(tc.args);
              return {
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                result,
                outputVariable: tc.outputVariable,
                blockIndex: tc.blockIndex,
                thread: tc.thread,
              };
            } catch (err) {
              return {
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                error: err instanceof Error ? err.message : 'Tool execution failed',
                outputVariable: tc.outputVariable,
                blockIndex: tc.blockIndex,
                thread: tc.thread,
              };
            }
          }),
        );

        // Emit tool-output events for server tools immediately
        for (const tr of serverResults) {
          if (tr.error) {
            yield { type: 'tool-output-error', toolCallId: tr.toolCallId, error: tr.error };
          } else {
            yield { type: 'tool-output-available', toolCallId: tr.toolCallId, output: tr.result };
          }
        }

        // If there are client tools, emit client-tool-request and stop the loop
        if (clientTools.length > 0) {
          if (!executionId) {
            yield createInternalErrorEvent('Missing executionId for client-tool-request');
            return;
          }
          // Include executionId and server results in event
          yield {
            type: 'client-tool-request',
            executionId,
            toolCalls: clientTools,
            serverToolResults: serverResults.length > 0 ? serverResults : undefined,
          };
          yield { type: 'finish', finishReason: 'client-tool-calls', executionId };
          continueLoop = false;
        } else {
          // All tools handled server-side, continue loop
          toolResults = serverResults;
        }
      } else {
        // No pending tools, we're done
        continueLoop = false;
      }
    }
  }

  private handleResourceUpdate(name: string, value: unknown): void {
    const resource = this.resourceMap.get(name);
    if (resource) {
      void resource.onUpdate(value);
    }
  }
}
