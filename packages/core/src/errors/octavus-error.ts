import type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  OctavusErrorOptions,
} from './types';

/**
 * Marker key for OctavusError identification.
 * Enables reliable instanceof checks across package versions.
 */
const MARKER_KEY = 'octavus.error';

/**
 * Base error class for Octavus streaming errors.
 *
 * Provides structured error information including:
 * - Error type classification for UI handling
 * - Source information (platform, provider, tool)
 * - Retryability flag and retry delay
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

  /** Provider details (when source === 'provider') */
  readonly provider?: ProviderErrorInfo;

  /** Tool details (when source === 'tool') */
  readonly tool?: ToolErrorInfo;

  constructor(options: OctavusErrorOptions) {
    super(options.message);
    this.name = 'OctavusError';
    this.errorType = options.errorType;
    this.source = options.source;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.code = options.code;
    this.provider = options.provider;
    this.tool = options.tool;

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
   * Convert error to plain object for serialization.
   * Used for streaming error events.
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
      provider: this.provider,
      tool: this.tool,
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
