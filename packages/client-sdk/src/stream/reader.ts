import { safeParseStreamEvent, isAbortError, type StreamEvent } from '@octavus/core';

/**
 * Parse SSE stream events.
 *
 * @param response - The HTTP response with SSE body
 * @param signal - Optional abort signal to cancel reading
 */
export async function* parseSSEStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    let reading = true;
    while (reading) {
      // Check if aborted before reading
      if (signal?.aborted) {
        return;
      }

      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        // Handle abort errors gracefully - exit without throwing
        if (isAbortError(err)) {
          return;
        }
        throw err;
      }

      const { done, value } = readResult;

      if (done) {
        reading = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const parsed = safeParseStreamEvent(JSON.parse(line.slice(6)));
            // An event of a type this SDK does not know is ignored, like a
            // malformed one: the chat has nothing to render for it.
            if (parsed.kind === 'event') {
              yield parsed.event;
            }
          } catch {
            // Skip malformed JSON - no logging in production
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
