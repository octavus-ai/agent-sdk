/** Structured error details from the execution error event */
export interface WorkerErrorDetails {
  /** Error type classification (e.g., 'validation_error', 'rate_limit_error') */
  errorType?: string;
  /** Where the error originated ('provider', 'platform', 'tool') */
  source?: string;
  /** Machine-readable error code (e.g., 'OPENAI_400', 'ANTHROPIC_429') */
  code?: string;
  /** Whether automatic retry is possible */
  retryable?: boolean;
  /** Provider details when the error originated from an LLM provider */
  provider?: {
    name: string;
    model?: string;
    statusCode?: number;
    errorType?: string;
    requestId?: string;
  };
}

/** Error thrown when a worker execution fails */
export class WorkerError extends Error {
  constructor(
    message: string,
    /** Session ID if the worker started before failing (for debugging URLs) */
    public readonly sessionId?: string,
    /** Structured error details from the execution error event */
    public readonly details?: WorkerErrorDetails,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}
