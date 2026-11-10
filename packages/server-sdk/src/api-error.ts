import type { ZodError } from 'zod';
import { OctavusError } from '@octavus/core';

/**
 * The error a failed platform response describes: the platform's error body
 * when it sent one (its message, code, classification, request ID, and any
 * data to act on), else the status and, for a body that is not JSON, its
 * content type. The body's text is never the message: a response the platform
 * did not answer (its host's or a proxy's error page) must not reach a person
 * as a wall of markup.
 */
export async function readApiError(
  response: Response,
  defaultMessage: string,
): Promise<OctavusError> {
  const text = await response.text().catch(() => '');
  const body = parseJson(text);
  return OctavusError.fromApiResponse(
    response.status,
    body,
    describeFailedResponse(response, defaultMessage, body === undefined),
    { requestId: response.headers.get('Request-Id') },
  );
}

/** The parsed JSON body, or `undefined` when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The message for a failed response that carried no platform error body:
 * the status and its reason (the reason is empty over HTTP/2, so the number
 * is always there), plus the content type when the body was not JSON, which
 * is what tells a proxy's HTML page apart from a platform answer.
 */
function describeFailedResponse(
  response: Response,
  defaultMessage: string,
  bodyNotJson: boolean,
): string {
  const reason = response.statusText ? ` ${response.statusText}` : '';
  const contentType = bodyNotJson ? ` (${mediaType(response)})` : '';
  return `${defaultMessage}: ${response.status}${reason}${contentType}`;
}

/** The response's media type, without its parameters (`text/html`, not `text/html; charset=utf-8`). */
function mediaType(response: Response): string {
  const contentType = response.headers.get('Content-Type');
  if (!contentType) return 'no Content-Type';
  return contentType.split(';')[0]!.trim() || 'no Content-Type';
}

/**
 * Read the error a failed platform response describes and throw it.
 */
export async function throwApiError(response: Response, defaultMessage: string): Promise<never> {
  throw await readApiError(response, defaultMessage);
}

/**
 * The error for a successful response whose body the SDK cannot read: one
 * that is not JSON, or one the response schema does not describe. The SDK's
 * one error class, like every other failure, classified as a platform fault
 * and carrying the response's status and request ID so the response can be
 * found.
 */
export function malformedResponseError(
  response: Response,
  reason: string,
  cause: unknown,
): OctavusError {
  return new OctavusError({
    errorType: 'internal_error',
    message: `Unexpected response from ${response.url}: ${reason}`,
    source: 'platform',
    retryable: false,
    status: response.status,
    requestId: response.headers.get('Request-Id') ?? undefined,
    cause,
  });
}

const MAX_DESCRIBED_ISSUES = 3;

/** The first few validation issues of a response body, one line: `path: message`. */
export function describeIssues(error: ZodError): string {
  const described = error.issues
    .slice(0, MAX_DESCRIBED_ISSUES)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`);
  const rest = error.issues.length - described.length;
  return `the body does not match the expected shape (${described.join('; ')}${
    rest > 0 ? `; +${rest} more` : ''
  })`;
}
