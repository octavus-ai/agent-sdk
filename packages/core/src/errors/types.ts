/**
 * Error classification types, inferred from the wire schemas so an error event
 * and an `OctavusError` describe an error the same way.
 */
import type { z } from 'zod';
import type {
  Wire,
  errorTypeSchema,
  errorSourceSchema,
  providerErrorInfoSchema,
  toolErrorInfoSchema,
  backupFailureInfoSchema,
} from '@/stream/schemas';

/**
 * Error type classification:
 * - `authentication_error` (401), `permission_error` (403)
 * - `validation_error` (400, 422), `not_found_error` (404), `conflict_error` (409)
 * - `rate_limit_error` (429, transient), `quota_exceeded_error` (402, a plan or
 *   usage allowance exhausted - terminal, never retried)
 * - `provider_error`, `provider_overloaded`, `provider_timeout`,
 *   `unsupported_error` (the model or provider cannot do what was asked)
 * - `execution_error`, `tool_error`, `protocol_error`
 * - `internal_error`, `unknown_error`
 */
export type ErrorType = z.infer<typeof errorTypeSchema>;

/** Where the error originated: the platform, an LLM provider, a tool, or the client. */
export type ErrorSource = z.infer<typeof errorSourceSchema>;

/**
 * Provider information for provider errors: the provider and model, its HTTP
 * status and error type, its request ID for support, a truncated raw response
 * body when it carries detail beyond the normalized message, and the upstream
 * deployment a gateway reported.
 */
export type ProviderErrorInfo = Wire<z.infer<typeof providerErrorInfoSchema>>;

/** Tool information for tool errors. */
export type ToolErrorInfo = Wire<z.infer<typeof toolErrorInfoSchema>>;

/**
 * How the configured backup model failed when it was tried after the primary
 * model's error. The error it is attached to stays the primary's (its type,
 * code, and retryability are what drove the failover); this records why the
 * failover did not rescue the request, which is often the actionable part - a
 * backup whose provider account is out of credits looks like a plain primary
 * failure without it.
 */
export type BackupFailureInfo = Wire<z.infer<typeof backupFailureInfoSchema>>;

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
  /** HTTP status of the response that carried the error, for a REST failure. */
  status?: number;
  /** The platform's request ID, to quote to support. */
  requestId?: string;
  /** Structured validation issues, when the platform returned them. */
  issues?: unknown[];
  /**
   * Any other fields of the error response body, for errors that carry data to
   * act on (for example the `currentThreadId` of an `AGENT_BUSY` error).
   */
  details?: Record<string, unknown>;
  provider?: ProviderErrorInfo;
  tool?: ToolErrorInfo;
  backup?: BackupFailureInfo;
  cause?: unknown;
  /**
   * Server-side-only diagnostic detail (e.g. a raw provider response body).
   * NEVER serialized to clients: it is intentionally excluded from
   * `OctavusError.toJSON()` and from stream error events, so it is safe to carry
   * internal detail here for logging. First-party masked providers, whose
   * consumer-facing message is genericized, use it to retain the real backend
   * reason for internal observability (Sentry) without leaking it.
   */
  internalDetails?: string;
}
