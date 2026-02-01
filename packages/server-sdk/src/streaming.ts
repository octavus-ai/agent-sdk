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

/**
 * Configuration for streaming execution.
 */
export interface StreamExecutionConfig {
  /** API client config with baseUrl and headers */
  config: ApiClientConfig;
  /** Tool handlers for server-side execution */
  toolHandlers: ToolHandlers;
  /** Full URL to make the request to */
  url: string;
  /** Build the request body for this execution */
  buildBody: (state: {
    executionId?: string;
    toolResults?: ToolResult[];
  }) => Record<string, unknown>;
  /** Called when a resource-update event is received (optional) */
  onResourceUpdate?: (name: string, value: unknown) => void;
  /** Error message prefix for API errors */
  errorContext?: string;
}

/**
 * Initial payload for starting an execution stream.
 */
export interface StreamExecutionPayload {
  /** Initial execution ID (for continuation) */
  executionId?: string;
  /** Initial tool results (for continuation) */
  toolResults?: ToolResult[];
}

/**
 * Executes a streaming request with tool continuation support.
 *
 * This is the shared implementation for both interactive sessions and workers.
 * It handles:
 * - SSE stream parsing
 * - Abort signal handling
 * - Tool-request interception and server/client splitting
 * - Automatic continuation for server-handled tools
 * - Client-tool-request emission for client-handled tools
 */
export async function* executeStream(
  config: StreamExecutionConfig,
  payload: StreamExecutionPayload,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let toolResults = payload.toolResults;
  let executionId = payload.executionId;
  let continueLoop = true;

  while (continueLoop) {
    if (signal?.aborted) {
      yield { type: 'finish', finishReason: 'stop' };
      return;
    }

    const body = config.buildBody({ executionId, toolResults });

    let response: Response;
    try {
      response = await fetch(config.url, {
        method: 'POST',
        headers: config.config.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }
      throw err;
    }

    if (!response.ok) {
      const { message } = await parseApiError(response, config.errorContext ?? 'Request failed');
      yield createApiErrorEvent(response.status, message);
      return;
    }

    if (!response.body) {
      yield createInternalErrorEvent('Response body is not readable');
      return;
    }

    toolResults = undefined;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingToolCalls: PendingToolCall[] | null = null;

    let streamDone = false;
    while (!streamDone) {
      if (signal?.aborted) {
        reader.releaseLock();
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }

      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
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
              continue;
            }
            const event = parsed.data;

            if (event.type === 'start' && event.executionId) {
              executionId = event.executionId;
            }

            if (event.type === 'tool-request') {
              pendingToolCalls = event.toolCalls;
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

            if (event.type === 'resource-update' && config.onResourceUpdate) {
              config.onResourceUpdate(event.name, event.value);
            }

            yield event;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    if (signal?.aborted) {
      yield { type: 'finish', finishReason: 'stop' };
      return;
    }

    if (pendingToolCalls && pendingToolCalls.length > 0) {
      const serverTools = pendingToolCalls.filter((tc) => config.toolHandlers[tc.toolName]);
      const clientTools = pendingToolCalls.filter((tc) => !config.toolHandlers[tc.toolName]);

      const serverResults = await Promise.all(
        serverTools.map(async (tc): Promise<ToolResult> => {
          const handler = config.toolHandlers[tc.toolName]!;
          try {
            const result = await handler(tc.args);
            return {
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              result,
              outputVariable: tc.outputVariable,
              blockIndex: tc.blockIndex,
              thread: tc.thread,
              workerId: tc.workerId,
            };
          } catch (err) {
            return {
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              error: err instanceof Error ? err.message : 'Tool execution failed',
              outputVariable: tc.outputVariable,
              blockIndex: tc.blockIndex,
              thread: tc.thread,
              workerId: tc.workerId,
            };
          }
        }),
      );

      for (const tr of serverResults) {
        if (tr.error) {
          yield { type: 'tool-output-error', toolCallId: tr.toolCallId, error: tr.error };
        } else {
          yield { type: 'tool-output-available', toolCallId: tr.toolCallId, output: tr.result };
        }
      }

      if (clientTools.length > 0) {
        if (!executionId) {
          yield createInternalErrorEvent('Missing executionId for client-tool-request');
          return;
        }
        yield {
          type: 'client-tool-request',
          executionId,
          toolCalls: clientTools,
          serverToolResults: serverResults.length > 0 ? serverResults : undefined,
        };
        yield { type: 'finish', finishReason: 'client-tool-calls', executionId };
        continueLoop = false;
      } else {
        toolResults = serverResults;
      }
    } else {
      continueLoop = false;
    }
  }
}
