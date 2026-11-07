import { OctavusError } from '@octavus/core';

/**
 * The error a failed platform response describes: the platform's error body
 * when it sent one (its message, code, classification, request ID, and any
 * data to act on), else the status and the response text.
 */
export async function readApiError(
  response: Response,
  defaultMessage: string,
): Promise<OctavusError> {
  const text = await response.text().catch(() => '');
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the text itself is the best message available.
  }
  return OctavusError.fromApiResponse(
    response.status,
    body,
    `${defaultMessage}: ${response.statusText}`,
    { requestId: response.headers.get('Request-Id') },
  );
}

/**
 * Read the error a failed platform response describes and throw it.
 */
export async function throwApiError(response: Response, defaultMessage: string): Promise<never> {
  throw await readApiError(response, defaultMessage);
}
