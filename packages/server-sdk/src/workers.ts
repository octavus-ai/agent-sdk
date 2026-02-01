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
import { BaseApiClient, type ApiClientConfig } from '@/base-api-client.js';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new worker execution */
export interface WorkerStartRequest {
  type: 'start';
  input: Record<string, unknown>;
}

/** Continue execution after client-side tool handling */
export interface WorkerContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}

/** All request types supported by workers */
export type WorkerRequest = WorkerStartRequest | WorkerContinueRequest;

// =============================================================================
// Execution Options
// =============================================================================

/** Options for worker execution */
export interface WorkerExecuteOptions {
  /** Tool handlers for server-side tool execution */
  tools?: ToolHandlers;
  /** Abort signal to cancel the execution */
  signal?: AbortSignal;
}

// =============================================================================
// Worker Execution Helper
// =============================================================================

/** Configuration for a worker execution stream */
interface WorkerStreamConfig {
  config: ApiClientConfig;
  agentId: string;
  toolHandlers: ToolHandlers;
}

/**
 * Execute a worker request and stream the response.
 * Handles the tool continuation pattern internally.
 */
async function* executeWorkerStream(
  streamConfig: WorkerStreamConfig,
  payload: {
    input?: Record<string, unknown>;
    executionId?: string;
    toolResults?: ToolResult[];
  },
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let toolResults = payload.toolResults;
  let executionId = payload.executionId;
  const isStart = payload.input !== undefined;
  let continueLoop = true;

  while (continueLoop) {
    // Check if aborted before making request
    if (signal?.aborted) {
      yield { type: 'finish', finishReason: 'stop' };
      return;
    }

    // Build request body
    const body: Record<string, unknown> =
      isStart && !executionId
        ? { type: 'start', input: payload.input }
        : { type: 'continue', executionId, toolResults };

    // Make request to platform
    let response: Response;
    try {
      response = await fetch(
        `${streamConfig.config.baseUrl}/api/agents/${streamConfig.agentId}/execute`,
        {
          method: 'POST',
          headers: streamConfig.config.getHeaders(),
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
      const { message } = await parseApiError(response, 'Failed to execute worker');
      yield createApiErrorEvent(response.status, message);
      return;
    }

    if (!response.body) {
      yield createInternalErrorEvent('Response body is not readable');
      return;
    }

    // Reset tool results for next iteration
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
      const serverTools = pendingToolCalls.filter((tc) => streamConfig.toolHandlers[tc.toolName]);
      const clientTools = pendingToolCalls.filter((tc) => !streamConfig.toolHandlers[tc.toolName]);

      const serverResults = await Promise.all(
        serverTools.map(async (tc): Promise<ToolResult> => {
          // Handler is guaranteed to exist since we filtered by handler presence
          const handler = streamConfig.toolHandlers[tc.toolName]!;
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

// =============================================================================
// Workers API
// =============================================================================

/** API for executing worker agents */
export class WorkersApi extends BaseApiClient {
  /**
   * Execute a worker agent and stream the response.
   *
   * Worker agents execute steps sequentially and return an output value.
   * Unlike interactive sessions, workers don't maintain persistent state.
   *
   * The execution handles the tool continuation pattern automatically:
   * - Server tools (with handlers provided) are executed automatically
   * - Client tools (without handlers) emit a client-tool-request event
   *
   * @param agentId - The worker agent ID
   * @param input - Input values for the worker
   * @param options - Optional configuration including tools and abort signal
   * @returns An async generator of stream events
   *
   * @example Basic execution
   * ```typescript
   * const events = client.workers.execute(agentId, { TOPIC: 'AI safety' });
   * for await (const event of events) {
   *   if (event.type === 'worker-start') {
   *     console.log(`Worker ${event.workerSlug} started (${event.workerId})`);
   *   }
   *   if (event.type === 'worker-result') {
   *     if (event.error) {
   *       console.error('Worker failed:', event.error);
   *     } else {
   *       console.log('Output:', event.output);
   *     }
   *   }
   * }
   * ```
   *
   * @example With tool handlers
   * ```typescript
   * const events = client.workers.execute(agentId, { TOPIC: 'AI safety' }, {
   *   tools: {
   *     'web-search': async (args) => {
   *       return await searchWeb(args.query);
   *     },
   *   },
   * });
   * ```
   */
  async *execute(
    agentId: string,
    input: Record<string, unknown>,
    options: WorkerExecuteOptions = {},
  ): AsyncGenerator<StreamEvent> {
    const streamConfig: WorkerStreamConfig = {
      config: this.config,
      agentId,
      toolHandlers: options.tools ?? {},
    };

    yield* executeWorkerStream(streamConfig, { input }, options.signal);
  }

  /**
   * Continue a worker execution after client-side tool handling.
   *
   * Use this when your worker has tools without server-side handlers.
   * The execution returns a client-tool-request event with an executionId.
   * Execute the tools client-side, then call this method to continue.
   *
   * @param agentId - The worker agent ID
   * @param executionId - The execution ID from the client-tool-request event
   * @param toolResults - Results from client-side tool execution
   * @param options - Optional configuration including tools and abort signal
   * @returns An async generator of stream events
   *
   * @example
   * ```typescript
   * // Start execution
   * for await (const event of client.workers.execute(agentId, input)) {
   *   if (event.type === 'client-tool-request') {
   *     // Execute tools client-side
   *     const results = await executeToolsClientSide(event.toolCalls);
   *     // Continue execution
   *     for await (const ev of client.workers.continue(agentId, event.executionId, results)) {
   *       // Handle remaining events
   *     }
   *   }
   * }
   * ```
   */
  async *continue(
    agentId: string,
    executionId: string,
    toolResults: ToolResult[],
    options: WorkerExecuteOptions = {},
  ): AsyncGenerator<StreamEvent> {
    const streamConfig: WorkerStreamConfig = {
      config: this.config,
      agentId,
      toolHandlers: options.tools ?? {},
    };

    yield* executeWorkerStream(streamConfig, { executionId, toolResults }, options.signal);
  }
}
