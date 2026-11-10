import { OctavusError, isAbortError, type ToolResult } from '@octavus/core';
import { parseSSEStream } from '@/stream/reader';
import type { Transport, TriggerOptions } from './types';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new trigger execution */
export interface TriggerRequest {
  type: 'trigger';
  triggerName: string;
  input?: Record<string, unknown>;
  rollbackAfterMessageId?: string | null;
}

/** Continue execution after client-side tool handling */
export interface ContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}

/** All request types supported by the HTTP transport */
export type HttpRequest = TriggerRequest | ContinueRequest;

// =============================================================================
// Transport Options
// =============================================================================

/** Request options passed to the request callback */
export interface HttpRequestOptions {
  /** Abort signal to cancel the request */
  signal?: AbortSignal;
}

/**
 * Options for creating an HTTP transport.
 */
export interface HttpTransportOptions {
  /**
   * Function to make requests to your backend.
   * Receives a discriminated union with `type` to identify the request kind.
   *
   * @param request - The request payload (check `request.type` for the kind)
   * @param options - Request options including abort signal
   * @returns Response with SSE stream body
   *
   * @example
   * ```typescript
   * request: (payload, options) =>
   *   fetch('/api/trigger', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ sessionId, ...payload }),
   *     signal: options?.signal,
   *   })
   * ```
   */
  request: (request: HttpRequest, options?: HttpRequestOptions) => Promise<Response>;
}

// =============================================================================
// Transport Implementation
// =============================================================================

/** The parsed JSON body, or `undefined` when the text is not JSON. */
function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The message for a failed response that carried no platform error body: the
 * status and its reason (empty over HTTP/2, so the number is always there),
 * plus the content type when the body was not JSON, which tells a proxy's or
 * a host's HTML page apart from a platform answer. The body's text is never
 * the message.
 */
function describeFailedResponse(response: Response, bodyNotJson: boolean): string {
  const reason = response.statusText ? ` ${response.statusText}` : '';
  const contentType = bodyNotJson ? ` (${mediaType(response)})` : '';
  return `Request failed: ${response.status}${reason}${contentType}`;
}

/** The response's media type, without its parameters (`text/html`, not `text/html; charset=utf-8`). */
function mediaType(response: Response): string {
  const contentType = response.headers.get('Content-Type');
  if (!contentType) return 'no Content-Type';
  return contentType.split(';')[0]!.trim() || 'no Content-Type';
}

/**
 * Create an HTTP transport using native fetch() and SSE parsing.
 * This is the default transport for Next.js and other HTTP-based applications.
 *
 * @example
 * ```typescript
 * const transport = createHttpTransport({
 *   request: (payload, options) =>
 *     fetch('/api/trigger', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ sessionId, ...payload }),
 *       signal: options?.signal,
 *     }),
 * });
 * ```
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  let abortController: AbortController | null = null;

  async function* streamResponse(responsePromise: Promise<Response>) {
    try {
      const response = await responsePromise;

      if (!response.ok) {
        // Surface a non-ok response as a typed error event so consumer onError
        // type guards and the retryable flag work. The platform's error body
        // (forwarded by the consumer's server) carries the message, code, and
        // request ID; any other body is classified by status and described by
        // it, never shown.
        const text = await response.text().catch(() => '');
        const body = parseJsonBody(text);
        yield OctavusError.fromApiResponse(
          response.status,
          body,
          describeFailedResponse(response, body === undefined),
          { requestId: response.headers.get('Request-Id') },
        ).toEvent();
        return;
      }

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      for await (const event of parseSSEStream(response, abortController!.signal)) {
        if (abortController?.signal.aborted) {
          break;
        }
        yield event;
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      throw err;
    }
  }

  return {
    async *trigger(triggerName, input, triggerOptions?: TriggerOptions) {
      abortController = new AbortController();
      const request: TriggerRequest = { type: 'trigger', triggerName, input };
      if (triggerOptions?.rollbackAfterMessageId !== undefined) {
        request.rollbackAfterMessageId = triggerOptions.rollbackAfterMessageId;
      }
      const response = options.request(request, { signal: abortController.signal });
      yield* streamResponse(response);
    },

    async *continueWithToolResults(executionId, toolResults) {
      abortController = new AbortController();
      const response = options.request(
        { type: 'continue', executionId, toolResults },
        { signal: abortController.signal },
      );
      yield* streamResponse(response);
    },

    stop() {
      abortController?.abort();
      abortController = null;
    },
  };
}
