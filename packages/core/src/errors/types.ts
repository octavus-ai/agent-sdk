/**
 * Error types for Octavus streaming errors.
 * These types categorize errors to enable appropriate UI handling.
 */
export type ErrorType =
  // Authentication & Authorization
  | 'authentication_error' // 401 - Invalid API key
  | 'permission_error' // 403 - No access to resource

  // Request Issues
  | 'validation_error' // 400 - Invalid request/input
  | 'not_found_error' // 404 - Resource not found

  // Rate Limiting
  | 'rate_limit_error' // 429 - Rate limit exceeded
  | 'quota_exceeded_error' // 429 - Usage quota exceeded

  // Provider Issues
  | 'provider_error' // 5xx - Provider-side failure
  | 'provider_overloaded' // 529/503 - Provider overloaded
  | 'provider_timeout' // 504 - Provider timeout
  | 'unsupported_error' // Feature not supported by the model/provider

  // Agent/Platform Issues
  | 'execution_error' // Agent execution failed
  | 'tool_error' // Tool execution failed
  | 'protocol_error' // Protocol parsing/validation failed

  // Catch-all
  | 'internal_error' // Unexpected platform error
  | 'unknown_error'; // Unclassified error

/**
 * Error source - where the error originated.
 */
export type ErrorSource =
  | 'platform' // Octavus platform error
  | 'provider' // LLM provider error (OpenAI, Anthropic, Google)
  | 'tool' // Tool execution error
  | 'client'; // Client-side error (transport, parsing)

/**
 * Provider information for provider errors.
 */
export interface ProviderErrorInfo {
  /** Provider name (e.g., 'openai', 'anthropic', 'google') */
  name: string;
  /** Model that caused the error */
  model?: string;
  /** HTTP status code from provider */
  statusCode?: number;
  /** Provider's error type string */
  errorType?: string;
  /** Provider's request ID for support */
  requestId?: string;
}

/**
 * Tool information for tool errors.
 */
export interface ToolErrorInfo {
  /** Tool name */
  name: string;
  /** Tool call ID */
  callId?: string;
}

/**
 * Options for creating an OctavusError.
 */
export interface OctavusErrorOptions {
  errorType: ErrorType;
  message: string;
  source: ErrorSource;
  retryable?: boolean;
  retryAfter?: number;
  code?: string;
  provider?: ProviderErrorInfo;
  tool?: ToolErrorInfo;
  cause?: unknown;
}
