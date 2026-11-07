import { z } from 'zod';
import { errorTypeSchema } from '@/stream/schemas';
import type { ErrorEvent } from '@/stream/types';
import type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  BackupFailureInfo,
  OctavusErrorOptions,
} from './types';

/**
 * Marker key for OctavusError identification.
 * Enables reliable instanceof checks across package versions.
 */
const MARKER_KEY = 'octavus.error';

/**
 * The body every non-2xx platform response carries: `error` (a readable
 * message) and `code` (a stable machine-readable code), with the error's
 * classification, whether a retry can help, the request ID, the validation
 * issues when there are any, and the retry delay when relevant. Parsed loosely
 * so an error that carries data to act on keeps it (see `details`).
 */
const apiErrorBodySchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  type: errorTypeSchema.optional(),
  retryable: z.boolean().optional(),
  requestId: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
  retryAfter: z.number().optional(),
});

/**
 * The classification of an HTTP failure that carried no `type`, by its
 * status. A platform route always sends a `type`, so a response without one
 * came from whatever stands in front of the platform (its host, a proxy, an
 * application's own passthrough), where a 503 or 504 is the upstream being
 * overloaded or slow rather than a platform fault.
 */
export function errorTypeForStatus(status: number): ErrorType {
  switch (status) {
    case 400:
    case 422:
      return 'validation_error';
    case 401:
      return 'authentication_error';
    case 402:
      return 'quota_exceeded_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 409:
      return 'conflict_error';
    case 426:
      return 'unsupported_error';
    case 429:
      return 'rate_limit_error';
    case 503:
      return 'provider_overloaded';
    case 504:
      return 'provider_timeout';
    default:
      return status >= 500 ? 'internal_error' : 'unknown_error';
  }
}

/**
 * Whether a retry can help with an HTTP failure that carried no `retryable`.
 * Such a 5xx is the platform's host or a proxy failing the request before a
 * route answered, which a retry usually clears; the platform's own answers
 * carry their `retryable` in the body.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** What a reader knows about a failed response beyond its body. */
export interface ApiResponseErrorOptions {
  /** The response's `Request-Id` header, used when the body carries no `requestId`. */
  requestId?: string | null;
}

/**
 * The one error of the SDK: a REST call that failed, or an error the stream
 * carried, with the same classification either way.
 *
 * Provides structured error information including:
 * - Error type classification for UI handling
 * - Source information (platform, provider, tool)
 * - Retryability flag and retry delay
 * - The HTTP status and the platform's request ID for a REST failure
 * - Provider/tool details when applicable
 *
 * @example
 * ```typescript
 * const error = new OctavusError({
 *   errorType: 'rate_limit_error',
 *   message: 'Rate limit exceeded. Please try again later.',
 *   source: 'provider',
 *   retryable: true,
 *   retryAfter: 60,
 *   provider: {
 *     name: 'anthropic',
 *     statusCode: 429,
 *     requestId: 'req_xxx',
 *   },
 * });
 * ```
 */
export class OctavusError extends Error {
  /** @internal Marker for cross-version instanceof checks */
  readonly __octavusErrorMarker = MARKER_KEY;

  /** Error type classification */
  readonly errorType: ErrorType;

  /** Where the error originated */
  readonly source: ErrorSource;

  /** Whether automatic retry is possible */
  readonly retryable: boolean;

  /** Suggested retry delay in seconds (from provider headers) */
  readonly retryAfter?: number;

  /** Machine-readable error code */
  readonly code?: string;

  /** HTTP status of the response that carried the error, for a REST failure */
  readonly status?: number;

  /** The platform's request ID, to quote to support */
  readonly requestId?: string;

  /** Structured validation issues, when the platform returned them */
  readonly issues?: unknown[];

  /** Any other fields of the error response body, for errors that carry data to act on */
  readonly details?: Record<string, unknown>;

  /** Provider details (when source === 'provider') */
  readonly provider?: ProviderErrorInfo;

  /** Tool details (when source === 'tool') */
  readonly tool?: ToolErrorInfo;

  /** How the backup model failed too, when one was tried after this error */
  readonly backup?: BackupFailureInfo;

  /**
   * Server-side-only diagnostic detail (e.g. a raw provider response body).
   * NEVER serialized to clients - intentionally excluded from {@link toJSON} and
   * from stream error events - so a masked/first-party provider can retain the
   * real backend reason for internal logging (Sentry) without ever leaking it to
   * a consumer.
   */
  readonly internalDetails?: string;

  constructor(options: OctavusErrorOptions) {
    super(options.message);
    this.name = 'OctavusError';
    this.errorType = options.errorType;
    this.source = options.source;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.issues = options.issues;
    this.details = options.details;
    this.provider = options.provider;
    this.tool = options.tool;
    this.backup = options.backup;
    this.internalDetails = options.internalDetails;

    // Preserve original error stack if available
    if (options.cause instanceof Error && options.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${options.cause.stack}`;
    }
  }

  /**
   * Check if an unknown value is an OctavusError.
   * Works reliably across package versions using marker property.
   */
  static isInstance(error: unknown): error is OctavusError {
    return (
      typeof error === 'object' &&
      error !== null &&
      '__octavusErrorMarker' in error &&
      (error as { __octavusErrorMarker: string }).__octavusErrorMarker === MARKER_KEY
    );
  }

  /**
   * The error a stream `error` event describes.
   */
  static fromEvent(event: ErrorEvent): OctavusError {
    return new OctavusError({
      errorType: event.errorType,
      message: event.message,
      source: event.source,
      retryable: event.retryable,
      retryAfter: event.retryAfter,
      code: event.code,
      requestId: event.requestId,
      provider: event.provider,
      tool: event.tool,
      backup: event.backup,
    });
  }

  /**
   * The error a non-2xx platform response describes. Reads the response's
   * error body when it is one (any other field it carries lands in `details`),
   * classifies by status when the body carries no `type`, and takes the
   * request ID from the body, else from the `Request-Id` header the caller
   * read.
   *
   * @param status - HTTP status code of the response
   * @param body - The parsed response body, or the raw text when it was not JSON
   * @param fallbackMessage - Message when the body carries none
   * @param options - The response's headers the error can use
   */
  static fromApiResponse(
    status: number,
    body: unknown,
    fallbackMessage: string,
    options: ApiResponseErrorOptions = {},
  ): OctavusError {
    const headerRequestId = options.requestId ?? undefined;
    const parsed = apiErrorBodySchema.safeParse(body);
    if (!parsed.success) {
      return new OctavusError({
        errorType: errorTypeForStatus(status),
        message: typeof body === 'string' && body.trim() ? body : fallbackMessage,
        source: 'platform',
        retryable: isRetryableStatus(status),
        status,
        requestId: headerRequestId,
      });
    }
    const { error, message, code, type, retryable, requestId, issues, retryAfter, ...details } =
      parsed.data;
    return new OctavusError({
      errorType: type ?? errorTypeForStatus(status),
      message: error ?? message ?? fallbackMessage,
      source: 'platform',
      retryable: retryable ?? isRetryableStatus(status),
      retryAfter,
      code,
      status,
      requestId: requestId ?? headerRequestId,
      issues,
      details: Object.keys(details).length > 0 ? details : undefined,
    });
  }

  /** An unexpected failure of the platform or the SDK itself. */
  static internal(message: string, options: { cause?: unknown } = {}): OctavusError {
    return new OctavusError({
      errorType: 'internal_error',
      message,
      source: 'platform',
      retryable: false,
      cause: options.cause,
    });
  }

  /**
   * The stream `error` event for this error, carrying everything a client
   * needs and nothing meant for the server's logs.
   */
  toEvent(): ErrorEvent {
    return {
      type: 'error',
      errorType: this.errorType,
      message: this.message,
      source: this.source,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      code: this.code,
      requestId: this.requestId,
      provider: this.provider,
      tool: this.tool,
      backup: this.backup,
    };
  }

  /**
   * Convert error to plain object for serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorType: this.errorType,
      source: this.source,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      code: this.code,
      status: this.status,
      requestId: this.requestId,
      issues: this.issues,
      details: this.details,
      provider: this.provider,
      tool: this.tool,
      backup: this.backup,
    };
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a transient rate limit (HTTP 429), retryable after a delay.
 *
 * This does NOT match `quota_exceeded_error` (HTTP 402), which is a terminal
 * plan/usage allowance block - use {@link isQuotaExceededError} for that.
 */
export function isRateLimitError(error: unknown): error is OctavusError {
  return OctavusError.isInstance(error) && error.errorType === 'rate_limit_error';
}

/**
 * Check if an error is a plan/usage allowance block (HTTP 402).
 *
 * Terminal, not retryable: the caller must resolve the underlying limit (upgrade
 * the plan or top up) before the request can succeed. Prompt the user to upgrade
 * rather than retrying automatically.
 */
export function isQuotaExceededError(error: unknown): error is OctavusError {
  return OctavusError.isInstance(error) && error.errorType === 'quota_exceeded_error';
}

/**
 * Check if an error is an authentication error.
 */
export function isAuthenticationError(error: unknown): error is OctavusError {
  return (
    OctavusError.isInstance(error) &&
    (error.errorType === 'authentication_error' || error.errorType === 'permission_error')
  );
}

/**
 * Check if an error is a provider error.
 */
export function isProviderError(error: unknown): error is OctavusError {
  return OctavusError.isInstance(error) && error.source === 'provider';
}

/**
 * Check if an error is a tool error.
 */
export function isToolError(error: unknown): error is OctavusError {
  return (
    OctavusError.isInstance(error) && (error.source === 'tool' || error.errorType === 'tool_error')
  );
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (OctavusError.isInstance(error)) {
    return error.retryable;
  }
  return false;
}

/**
 * Check if an error is a validation error (non-retryable request issue).
 */
export function isValidationError(error: unknown): error is OctavusError {
  return OctavusError.isInstance(error) && error.errorType === 'validation_error';
}

/**
 * Check if an error is a resource that could not be found (HTTP 404).
 */
export function isNotFoundError(error: unknown): error is OctavusError {
  return OctavusError.isInstance(error) && error.errorType === 'not_found_error';
}
