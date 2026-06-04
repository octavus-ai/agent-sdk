import type { ErrorType, ErrorSource, ProviderErrorInfo, ToolErrorInfo } from './errors/types';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface LogEntryFile {
  id: string;
  mediaType: string;
  url: string;
  filename?: string;
  size?: number;
}

export interface LoggedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Stand-in for a heavy log field whose original value was too large to store
 * in full. The middle is dropped and only `preview` - the head plus the tail of
 * the serialized original - is kept, so the field stays inspectable instead of
 * being discarded wholesale.
 *
 * Producers construct it as a plain object literal so it stays assignable to
 * both `unknown` and `Record<string, unknown>` payload fields (a fresh object
 * literal carries an implicit index signature); consumers narrow back to this
 * shape with `isTrimmedValue`.
 */
export interface TrimmedValue {
  __trimmed: true;
  /** UTF-8 byte length of the original serialized value, before trimming. */
  originalBytes: number;
  /** UTF-8 byte length of the retained `preview`. */
  keptBytes: number;
  /** Head + tail of the serialized original, with the middle removed. */
  preview: string;
}

/** Narrow an arbitrary payload value to a {@link TrimmedValue}. */
export function isTrimmedValue(value: unknown): value is TrimmedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __trimmed?: unknown }).__trimmed === true
  );
}

/**
 * Full model request payload captured for debugging.
 * Includes both LLM and image generation requests.
 */
export interface ModelRequestTrace {
  requestType: 'llm' | 'image';
  provider: string;
  model: string;
  /** Raw HTTP request body sent to the provider */
  requestBody?: unknown;
  prompt?: string;
  size?: string;
  hasReferenceImages?: boolean;
}

/**
 * Post-step token usage captured after a model step completes.
 * Emitted separately from the request-body trace so the UI can surface
 * billing / cache visibility without entangling it with the noisy
 * request payload entry.
 */
export interface StepStatsTrace {
  requestType: 'llm' | 'image';
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    cachedWriteTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  /**
   * Prompt-caching mode the provider actually applied for this step.
   * Undefined on image rows and on providers that don't apply caching.
   */
  cacheMode?: 'auto' | 'extended' | 'off';
}

/**
 * Error information logged during execution.
 * Stack traces are logged internally but not included here.
 */
export interface ExecutionLogError {
  type: ErrorType;
  message: string;
  source: ErrorSource;
  retryable?: boolean;
  retryAfter?: number;
  code?: string;
  provider?: ProviderErrorInfo;
  tool?: ToolErrorInfo;
}

// ---------------------------------------------------------------------------
// Entry type literal union
// ---------------------------------------------------------------------------

export type ExecutionLogEntryType =
  | 'trigger'
  | 'message'
  | 'tool-call'
  | 'tool-result'
  | 'llm-tool-request'
  | 'llm-response'
  | 'reasoning'
  | 'thread-created'
  | 'block-operation'
  | 'model-request'
  | 'step-stats'
  | 'worker-execution'
  | 'worker-output'
  | 'abort'
  | 'error';

// ---------------------------------------------------------------------------
// Base fields shared by all entry types
// ---------------------------------------------------------------------------

export interface ExecutionLogEntryBase {
  id: string;
  timestamp: string;
  /** Monotonic counter within a single execution for deterministic ordering */
  sequence?: number;
  /** Thread name for thread-scoped operations */
  thread?: string;
  blockName?: string;
  model?: string;
  /** Correlation ID for grouping all log entries from a single worker invocation */
  workerId?: string;
  workerSlug?: string;
  /**
   * Set when one or more heavy fields on this entry were trimmed to a head/tail
   * preview (or dropped) to fit the per-entry storage cap. Lets the UI flag the
   * entry as not showing the full payload. See {@link TrimmedValue}.
   */
  trimmed?: boolean;
}

// ---------------------------------------------------------------------------
// Per-type variant interfaces
// ---------------------------------------------------------------------------

export interface TriggerLogEntry extends ExecutionLogEntryBase {
  type: 'trigger';
  triggerName?: string;
  triggerInput?: Record<string, unknown>;
}

export interface MessageLogEntry extends ExecutionLogEntryBase {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content?: string;
  visible?: boolean;
  /** If set, this message is a structured object response (JSON) of this type */
  responseType?: string;
  files?: LogEntryFile[];
}

export interface ToolCallLogEntry extends ExecutionLogEntryBase {
  type: 'tool-call';
  toolName?: string;
  toolDescription?: string;
  toolArguments?: Record<string, unknown>;
}

export interface ToolResultLogEntry extends ExecutionLogEntryBase {
  type: 'tool-result';
  toolName?: string;
  toolResult?: unknown;
}

export interface LlmToolRequestLogEntry extends ExecutionLogEntryBase {
  type: 'llm-tool-request';
  response?: string;
  toolCalls?: LoggedToolCall[];
}

export interface LlmResponseLogEntry extends ExecutionLogEntryBase {
  type: 'llm-response';
  response?: string;
}

export interface ReasoningLogEntry extends ExecutionLogEntryBase {
  type: 'reasoning';
  reasoningContent?: string;
}

export interface ThreadCreatedLogEntry extends ExecutionLogEntryBase {
  type: 'thread-created';
  systemPrompt?: string;
}

export interface BlockOperationLogEntry extends ExecutionLogEntryBase {
  type: 'block-operation';
  operationType?: string;
  operationDescription?: string;
  operationInput?: Record<string, unknown>;
  operationResult?: unknown;
}

export interface ModelRequestLogEntry extends ExecutionLogEntryBase {
  type: 'model-request';
  modelRequest?: ModelRequestTrace;
}

export interface StepStatsLogEntry extends ExecutionLogEntryBase {
  type: 'step-stats';
  stepStats?: StepStatsTrace;
}

export interface WorkerExecutionLogEntry extends ExecutionLogEntryBase {
  type: 'worker-execution';
  workerInput?: Record<string, unknown>;
}

export interface WorkerOutputLogEntry extends ExecutionLogEntryBase {
  type: 'worker-output';
  workerOutput?: unknown;
}

export interface AbortLogEntry extends ExecutionLogEntryBase {
  type: 'abort';
  abortedAtBlock?: string;
}

export interface ErrorLogEntry extends ExecutionLogEntryBase {
  type: 'error';
  error?: ExecutionLogError;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type ExecutionLogEntry =
  | TriggerLogEntry
  | MessageLogEntry
  | ToolCallLogEntry
  | ToolResultLogEntry
  | LlmToolRequestLogEntry
  | LlmResponseLogEntry
  | ReasoningLogEntry
  | ThreadCreatedLogEntry
  | BlockOperationLogEntry
  | ModelRequestLogEntry
  | StepStatsLogEntry
  | WorkerExecutionLogEntry
  | WorkerOutputLogEntry
  | AbortLogEntry
  | ErrorLogEntry;
