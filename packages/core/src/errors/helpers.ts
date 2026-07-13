import type { ErrorEvent } from '@/stream/types';
import type { ErrorType, ErrorSource, ProviderErrorInfo, ToolErrorInfo } from './types';
import type { OctavusError } from './octavus-error';

/**
 * Options for creating an error event.
 */
export interface CreateErrorEventOptions {
  errorType: ErrorType;
  message: string;
  source: ErrorSource;
  retryable?: boolean;
  retryAfter?: number;
  code?: string;
  provider?: ProviderErrorInfo;
  tool?: ToolErrorInfo;
}

/**
 * Create an ErrorEvent from options.
 * Use this for constructing error events in streaming responses.
 */
export function createErrorEvent(options: CreateErrorEventOptions): ErrorEvent {
  return {
    type: 'error',
    errorType: options.errorType,
    message: options.message,
    source: options.source,
    retryable: options.retryable ?? false,
    retryAfter: options.retryAfter,
    code: options.code,
    provider: options.provider,
    tool: options.tool,
  };
}

/**
 * Create an ErrorEvent from an OctavusError.
 */
export function errorToStreamEvent(error: OctavusError): ErrorEvent {
  return createErrorEvent({
    errorType: error.errorType,
    message: error.message,
    source: error.source,
    retryable: error.retryable,
    retryAfter: error.retryAfter,
    code: error.code,
    provider: error.provider,
    tool: error.tool,
  });
}

/**
 * Create an internal error event.
 * Convenience function for platform-level errors.
 */
export function createInternalErrorEvent(message: string): ErrorEvent {
  return createErrorEvent({
    errorType: 'internal_error',
    message,
    source: 'platform',
    retryable: false,
  });
}

/**
 * Map HTTP status code to error type.
 */
function mapStatusCodeToErrorType(statusCode: number): ErrorType {
  switch (statusCode) {
    case 400:
      return 'validation_error';
    case 401:
      return 'authentication_error';
    case 402:
      return 'quota_exceeded_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 429:
      return 'rate_limit_error';
    case 503:
      return 'provider_overloaded';
    case 504:
      return 'provider_timeout';
    default:
      return statusCode >= 500 ? 'internal_error' : 'unknown_error';
  }
}

/**
 * Create an error event from an API response.
 * Maps HTTP status codes to appropriate error types.
 *
 * Use this when handling errors from API responses (before streaming starts).
 *
 * @param statusCode - HTTP status code from the response
 * @param message - Error message to display
 */
export function createApiErrorEvent(statusCode: number, message: string): ErrorEvent {
  const errorType = mapStatusCodeToErrorType(statusCode);
  // Rate limit and server errors are typically retryable
  const retryable = statusCode === 429 || statusCode >= 500;

  return createErrorEvent({
    errorType,
    message,
    source: 'platform',
    retryable,
  });
}
