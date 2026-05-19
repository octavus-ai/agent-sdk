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

// =============================================================================
// Retry helpers
// =============================================================================

const DEFAULT_MAX_RETRIES = 2;
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;
const RETRY_JITTER_FACTOR = 0.25;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds. The spec allows
 * both an integer number of seconds and an HTTP-date. Returns `null` if the
 * value matches neither, so the caller can fall back to exponential backoff.
 */
function parseRetryAfterMs(value: string): number | null {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

async function retryDelay(
  attempt: number,
  response: Response | null,
  signal?: AbortSignal,
): Promise<void> {
  const retryAfter = response?.headers.get('retry-after');
  const parsedRetryAfter = retryAfter ? parseRetryAfterMs(retryAfter) : null;

  let delayMs: number;
  if (parsedRetryAfter !== null) {
    // Clamp so a misbehaving server (or malicious proxy) sending a huge
    // `Retry-After` can't pin the session waiting for hours.
    delayMs = Math.min(parsedRetryAfter, RETRY_MAX_DELAY_MS);
  } else {
    const base = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
    const jitter = base * RETRY_JITTER_FACTOR * (Math.random() * 2 - 1);
    delayMs = base + jitter;
  }

  if (signal?.aborted) return;

  await new Promise<void>((resolve, reject) => {
    // Use a ref object so `onAbort` can clear the timer that gets set after
    // it, without tripping `no-use-before-define`. Removing the abort
    // listener when the timer wins the race keeps long sessions with many
    // retry rounds from accumulating listeners on the caller's signal.
    const handle: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
    const onAbort = () => {
      if (handle.timer !== null) clearTimeout(handle.timer);
      reject(signal!.reason instanceof Error ? signal!.reason : new Error('Aborted'));
    };
    handle.timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Configuration for streaming execution.
 */
export interface StreamExecutionConfig {
  /** API client config with baseUrl and headers */
  config: ApiClientConfig;
  /** Tool handlers for server-side execution. Resolved on each continuation loop. */
  getToolHandlers: () => ToolHandlers;
  /** Full URL to make the request to */
  url: string;
  /** Build the request body for this execution */
  buildBody: (state: {
    executionId?: string;
    toolResults?: ToolResult[];
  }) => Record<string, unknown>;
  /** Called when a resource-update event is received (optional) */
  onResourceUpdate?: (name: string, value: unknown) => void;
  /** Called after server-side tools execute, before yielding events or continuing. Use to normalize tool results (e.g., upload base64 images). */
  onToolResults?: (results: ToolResult[]) => Promise<void>;
  /** Error message prefix for API errors */
  errorContext?: string;
  /**
   * When true, tool calls without a registered handler return an error result
   * instead of being emitted as client-tool-request events.
   * Use for server-only execution environments (e.g., OctoAgents) that have
   * no client-side tool executor.
   */
  rejectClientToolCalls?: boolean;
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
    const maxRetries = Math.max(0, config.config.maxRetries ?? DEFAULT_MAX_RETRIES);

    let response!: Response;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }

      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: config.config.getHeaders(),
          body: JSON.stringify(body),
          signal,
        });

        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          // Release the socket promptly; the body is unused before we retry.
          await response.body?.cancel().catch(() => {});
          await retryDelay(attempt, response, signal);
          continue;
        }

        break;
      } catch (err) {
        if (isAbortError(err)) {
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }
        if (attempt < maxRetries && isRetryableNetworkError(err)) {
          await retryDelay(attempt, null, signal);
          continue;
        }
        throw err;
      }
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
      const toolHandlers = config.getToolHandlers();
      const serverTools = pendingToolCalls.filter((tc) => toolHandlers[tc.toolName]);
      const clientTools = pendingToolCalls.filter((tc) => !toolHandlers[tc.toolName]);

      const toolExecution = Promise.all(
        serverTools.map(async (tc): Promise<ToolResult> => {
          const handler = toolHandlers[tc.toolName]!;
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

      // Race tool execution against the abort signal so the stream can stop
      // immediately rather than waiting for slow tools (browser navigation,
      // shell commands, VM HTTP calls) to complete.
      let serverResults: ToolResult[];
      if (signal && !signal.aborted) {
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<'aborted'>((resolve) => {
          onAbort = () => resolve('aborted');
          signal.addEventListener('abort', onAbort, { once: true });
        });
        let raceResult: ToolResult[] | 'aborted';
        try {
          raceResult = await Promise.race([toolExecution, aborted]);
        } finally {
          // Remove the listener if `toolExecution` won the race so a long
          // session with many tool-call rounds doesn't accumulate one
          // listener per round on the caller's signal.
          if (onAbort) signal.removeEventListener('abort', onAbort);
        }
        if (raceResult === 'aborted') {
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }
        serverResults = raceResult;
      } else if (signal?.aborted) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      } else {
        serverResults = await toolExecution;
      }

      if (config.onToolResults && serverResults.length > 0) {
        await config.onToolResults(serverResults);
      }

      if (signal?.aborted) {
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }

      for (const tr of serverResults) {
        if (tr.error) {
          yield { type: 'tool-output-error', toolCallId: tr.toolCallId, error: tr.error };
        } else {
          yield { type: 'tool-output-available', toolCallId: tr.toolCallId, output: tr.result };
        }
      }

      if (clientTools.length > 0) {
        if (config.rejectClientToolCalls) {
          const rejectedResults: ToolResult[] = clientTools.map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            error: `Tool "${tc.toolName}" is not available. No handler is registered for this tool.`,
            outputVariable: tc.outputVariable,
            blockIndex: tc.blockIndex,
            thread: tc.thread,
            workerId: tc.workerId,
          }));
          for (const tr of rejectedResults) {
            yield { type: 'tool-output-error', toolCallId: tr.toolCallId, error: tr.error! };
          }
          toolResults = [...serverResults, ...rejectedResults];
        } else {
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
        }
      } else {
        toolResults = serverResults;
      }
    } else {
      continueLoop = false;
    }
  }
}
