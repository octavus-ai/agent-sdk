import type { ZodError } from 'zod';
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
