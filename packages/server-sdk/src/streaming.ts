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
import {
  MAX_CONTINUATION_BODY_BYTES,
  CONTINUATION_BODY_RESERVE_BYTES,
  enforceToolResultsSize,
  utf8ByteLength,
  formatBytes,
  type ToolResultTruncation,
} from '@/tool-result-size.js';

// =============================================================================
// Retry helpers
// =============================================================================

const DEFAULT_MAX_RETRIES = 2;
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;
const RETRY_JITTER_FACTOR = 0.25;

/**
 * Default idle timeout for the streaming connection. The platform emits an SSE
 * heartbeat (`: heartbeat`) every 15s, so a healthy connection is never silent
 * for longer than that. If no bytes (data or heartbeat) arrive for this long,
 * the connection is treated as dead: the generator ends like a real transport
 * drop - without a `finish` or `error` event - so the caller's retry path
 * recovers (re-trigger -> the runtime injects synthetic cancelled tool results
 * for the orphaned tool calls -> the agent re-issues them) instead of hanging
 * indefinitely. The same bound guards the connect/headers phase.
 */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

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
  /**
   * Full URL to make the request to. May be a function so it can change between
   * legs of the same execution - e.g. a deferred session posts its first leg to
   * the create-and-trigger endpoint and later legs to the per-session endpoint
   * once the id is known. Resolved on every POST.
   */
  url: string | (() => string);
  /** Build the request body for this execution */
  buildBody: (state: {
    executionId?: string;
    toolResults?: ToolResult[];
  }) => Record<string, unknown>;
  /**
   * Called once for each successful (2xx) response, after headers arrive and
   * before the body is consumed. Lets a caller read response headers (e.g. a
   * server-assigned session id) before streaming begins.
   */
  onResponse?: (response: Response) => void;
  /**
   * Called with the session id carried on a `start` event. A fallback id channel
   * for a deferred start when the response header is unavailable (e.g. a proxy
   * strips it, or a header-less transport); the caller's own guard keeps this a
   * no-op when the header already latched the id.
   */
  onSessionId?: (sessionId: string) => void;
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
  /**
   * Called for each tool result that was too large to send and was reduced to a
   * preview before the continuation POST. Optional hook for logging/telemetry -
   * the reduction happens regardless of whether it is set.
   */
  onToolResultTruncated?: (info: ToolResultTruncation) => void;
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

  const idleTimeoutMs = Math.max(
    0,
    config.config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  );

  const maxBodyBytes = config.config.maxContinuationBytes ?? MAX_CONTINUATION_BODY_BYTES;
  // Never reserve more than half the cap, so a small custom `maxContinuationBytes`
  // still leaves a positive budget for the tool results instead of forcing every
  // continuation straight into the overflow path.
  const toolResultsBudget =
    maxBodyBytes - Math.min(CONTINUATION_BODY_RESERVE_BYTES, Math.floor(maxBodyBytes / 2));

  while (continueLoop) {
    if (signal?.aborted) {
      yield { type: 'finish', finishReason: 'stop' };
      return;
    }

    // Transport-safety guard: keep the continuation body under the platform's
    // request-body limit. A tool result larger than the limit (e.g. a big query
    // dump) would otherwise be rejected with a 413 before it reaches the
    // platform, failing the whole run invisibly. Instead we reduce
    // oversized results to a head+tail preview with actionable guidance so the
    // run continues and the model can self-correct. Media/file outputs are
    // already offloaded to S3 by `onToolResults` at the end of the prior loop.
    const sized = enforceToolResultsSize(toolResults, toolResultsBudget);
    toolResults = sized.results;
    if (config.onToolResultTruncated) {
      for (const truncation of sized.truncations) {
        config.onToolResultTruncated(truncation);
      }
    }

    const body = config.buildBody({ executionId, toolResults });

    // Extremely rare: the results could not be reduced under the limit (e.g. a
    // huge number of results, or oversized non-result body fields). Fail loudly
    // with an actionable message rather than POSTing a body that will 413.
    if (sized.overflow || utf8ByteLength(JSON.stringify(body)) > maxBodyBytes) {
      yield createApiErrorEvent(
        413,
        `${config.errorContext ?? 'Request'}: the results are too large to send (over ` +
          `${formatBytes(maxBodyBytes)}) and could not be reduced enough. Return less data - ` +
          `filter, limit, or paginate the results, or write them to a file and return a reference.`,
      );
      return;
    }
    const maxRetries = Math.max(0, config.config.maxRetries ?? DEFAULT_MAX_RETRIES);

    let response!: Response;
    let haveResponse = false;
    // The controller bound to the response we end up reading. The caller's
    // abort is forwarded onto it so a user Stop still interrupts a blocked
    // read; it is detached in the outer `finally` once this request's body is
    // fully consumed (or the iteration unwinds).
    let bodyController: AbortController | undefined;
    let bodyAbortListener: (() => void) | undefined;
    // Captured from the trigger/continue stream; read after the body is fully
    // consumed to decide whether to execute pending tools and continue.
    let pendingToolCalls: PendingToolCall[] | null = null;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }

        // Per-attempt controller: it forwards the caller abort and is aborted
        // by a connect/headers timeout, so a frozen connection can never hang
        // the request before the first byte arrives. A successful attempt keeps
        // its controller alive for the body-read phase.
        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort(signal?.reason);
        if (signal) {
          if (signal.aborted) attemptController.abort(signal.reason);
          else signal.addEventListener('abort', onAbort, { once: true });
        }
        let connectTimedOut = false;
        const connectTimer =
          idleTimeoutMs > 0
            ? setTimeout(() => {
                connectTimedOut = true;
                attemptController.abort();
              }, idleTimeoutMs)
            : undefined;

        let keepController = false;
        try {
          const url = typeof config.url === 'function' ? config.url() : config.url;
          response = await fetch(url, {
            method: 'POST',
            headers: config.config.getHeaders(),
            body: JSON.stringify(body),
            signal: attemptController.signal,
          });

          if (isRetryableStatus(response.status) && attempt < maxRetries) {
            // Release the socket promptly; the body is unused before we retry.
            await response.body?.cancel().catch(() => {});
            await retryDelay(attempt, response, signal);
            continue;
          }

          haveResponse = true;
          keepController = true;
          bodyController = attemptController;
          bodyAbortListener = onAbort;
          break;
        } catch (err) {
          // A caller-driven abort always wins and ends the stream cleanly.
          if (signal?.aborted) {
            yield { type: 'finish', finishReason: 'stop' };
            return;
          }
          // Our own connect-timeout abort: retry, then fall through to a
          // transport drop (return without a terminal event) so the caller's
          // retry path can recover.
          if (connectTimedOut) {
            if (attempt < maxRetries) {
              await retryDelay(attempt, null, signal);
              continue;
            }
            return;
          }
          if (attempt < maxRetries && isRetryableNetworkError(err)) {
            await retryDelay(attempt, null, signal);
            continue;
          }
          throw err;
        } finally {
          if (connectTimer) clearTimeout(connectTimer);
          // Detach the listener for any attempt we are not keeping; the kept
          // attempt's listener is removed in the outer `finally`.
          if (!keepController && signal) signal.removeEventListener('abort', onAbort);
        }
      }

      if (!haveResponse) return;

      if (!response.ok) {
        const { message } = await parseApiError(response, config.errorContext ?? 'Request failed');
        yield createApiErrorEvent(response.status, message);
        return;
      }

      if (!response.body) {
        yield createInternalErrorEvent('Response body is not readable');
        return;
      }

      // Surface response headers (e.g. a server-assigned session id) before the
      // body is consumed, so the caller can latch them for subsequent legs.
      config.onResponse?.(response);

      toolResults = undefined;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let streamDone = false;
      while (!streamDone) {
        if (signal?.aborted) {
          reader.releaseLock();
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }

        // Race the read against an inactivity timer (reset each read). The
        // platform heartbeats every 15s, so no bytes for `idleTimeoutMs` means
        // the connection is dead (frozen socket, dropped continuation,
        // dark-wake). End the generator like a real drop so the caller's retry
        // path recovers instead of hanging forever.
        const readPromise = reader.read();
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let outcome: ReadableStreamReadResult<Uint8Array> | 'idle';
        try {
          if (idleTimeoutMs > 0) {
            const idlePromise = new Promise<'idle'>((resolve) => {
              idleTimer = setTimeout(() => resolve('idle'), idleTimeoutMs);
            });
            outcome = await Promise.race([readPromise, idlePromise]);
          } else {
            outcome = await readPromise;
          }
        } catch (err) {
          if (idleTimer) clearTimeout(idleTimer);
          if (isAbortError(err)) {
            reader.releaseLock();
            yield { type: 'finish', finishReason: 'stop' };
            return;
          }
          throw err;
        }
        if (idleTimer) clearTimeout(idleTimer);

        if (outcome === 'idle') {
          // Swallow the abandoned read's eventual settlement so cancelling the
          // body does not surface an unhandled rejection.
          void readPromise.then(
            () => undefined,
            () => undefined,
          );
          await reader.cancel().catch(() => {});
          return;
        }

        const { done, value } = outcome;

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

              if (event.type === 'start' && event.sessionId) {
                config.onSessionId?.(event.sessionId);
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
    } finally {
      // Detach the caller-abort listener bound to this request's body so a
      // long session with many continuation rounds doesn't accumulate one
      // listener per round on the caller's signal.
      if (bodyController && bodyAbortListener && signal) {
        signal.removeEventListener('abort', bodyAbortListener);
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
