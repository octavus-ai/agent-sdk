/**
 * Stream event types for Octavus agent communication.
 *
 * Events are organized into two categories:
 * - Standard Events (====): Common streaming patterns for AI agents
 * - Octavus Events (----): Octavus-specific protocol events
 */

/**
 * Display mode - controls execution indicator visibility (NOT final message visibility).
 * - hidden: Block runs silently
 * - name: Shows block/tool name
 * - description: Shows description
 * - stream: Shows live streaming content
 */
import type { ErrorType, ErrorSource, ProviderErrorInfo, ToolErrorInfo } from '@/errors/types';

export type DisplayMode = 'hidden' | 'name' | 'description' | 'stream';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolHandlers = Record<string, ToolHandler>;

/**
 * Reference to an uploaded file.
 * Used in trigger input and user messages for file attachments.
 * Compatible with UIFilePart structure for rendering.
 */
export interface FileReference {
  /** Unique file ID (platform-generated) */
  id: string;
  /** IANA media type (e.g., 'image/png', 'application/pdf') */
  mediaType: string;
  /** Presigned download URL (S3) */
  url: string;
  /** Original filename */
  filename?: string;
  /** File size in bytes */
  size?: number;
}
export type ResourceUpdateHandler = (name: string, value: unknown) => Promise<void> | void;
export type MessageRole = 'user' | 'assistant' | 'system';
export type ToolCallStatus = 'pending' | 'streaming' | 'available' | 'error';

export interface ToolCallInfo {
  id: string;
  name: string;
  description?: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  /** Google Gemini 3 thought signature - required for tool call continuation */
  thoughtSignature?: string;
}

// =============================================================================
// STANDARD EVENTS
// =============================================================================

// ============================== Lifecycle ====================================

/** Signals the start of a response message */
export interface StartEvent {
  type: 'start';
  messageId?: string;
  /** Execution ID for tool continuation. Used by client to resume after client-side tool handling. */
  executionId?: string;
}

/** Signals completion of streaming */
export interface FinishEvent {
  type: 'finish';
  finishReason: FinishReason;
  /** Execution ID for cleanup confirmation. Present when execution completes or pauses for client tools. */
  executionId?: string;
}

/**
 * Re-export error types for convenience.
 */
export type { ErrorType, ErrorSource, ProviderErrorInfo, ToolErrorInfo };

/**
 * Error during streaming.
 *
 * Enhanced with structured error information including:
 * - Error type classification for UI handling
 * - Source information (platform, provider, tool)
 * - Retryability flag and retry delay
 * - Provider/tool details when applicable
 *
 * @example Rate limit error from provider
 * ```typescript
 * {
 *   type: 'error',
 *   errorType: 'rate_limit_error',
 *   message: 'Rate limit exceeded',
 *   source: 'provider',
 *   retryable: true,
 *   retryAfter: 60,
 *   provider: { name: 'anthropic', statusCode: 429 }
 * }
 * ```
 */
export interface ErrorEvent {
  type: 'error';

  /** Error type classification for UI handling */
  errorType: ErrorType;

  /** Human-readable error message */
  message: string;

  /** Whether automatic retry is possible */
  retryable: boolean;

  /** Where the error originated */
  source: ErrorSource;

  /** Suggested retry delay in seconds (from provider headers) */
  retryAfter?: number;

  /** Machine-readable error code */
  code?: string;

  /** Provider details (when source === 'provider') */
  provider?: ProviderErrorInfo;

  /** Tool details (when source === 'tool') */
  tool?: ToolErrorInfo;
}

export type FinishReason =
  | 'stop'
  | 'tool-calls'
  | 'client-tool-calls'
  | 'length'
  | 'content-filter'
  | 'error'
  | 'other';

// ================================= Text ======================================

/**
 * Start of text generation for a specific text part.
 *
 * If `responseType` is set, the text content is JSON matching a custom type.
 * The client SDK should parse the text as a structured object instead of
 * displaying it as plain text.
 */
export interface TextStartEvent {
  type: 'text-start';
  id: string;
  /**
   * If specified, the text content is JSON matching this type name.
   * Client SDK should parse as object, not display as text.
   */
  responseType?: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Incremental text content */
export interface TextDeltaEvent {
  type: 'text-delta';
  id: string;
  delta: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** End of text generation for a specific text part */
export interface TextEndEvent {
  type: 'text-end';
  id: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

// =============================== Reasoning ===================================

/** Start of reasoning/thinking generation */
export interface ReasoningStartEvent {
  type: 'reasoning-start';
  id: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Incremental reasoning content */
export interface ReasoningDeltaEvent {
  type: 'reasoning-delta';
  id: string;
  delta: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** End of reasoning generation */
export interface ReasoningEndEvent {
  type: 'reasoning-end';
  id: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

// ================================= Tool ======================================

/** Tool call initiated - input streaming will follow */
export interface ToolInputStartEvent {
  type: 'tool-input-start';
  toolCallId: string;
  toolName: string;
  /** Human-readable title/description for the tool call */
  title?: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Incremental tool input/arguments */
export interface ToolInputDeltaEvent {
  type: 'tool-input-delta';
  toolCallId: string;
  inputTextDelta: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Tool input streaming has ended */
export interface ToolInputEndEvent {
  type: 'tool-input-end';
  toolCallId: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Tool input is complete and available */
export interface ToolInputAvailableEvent {
  type: 'tool-input-available';
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Tool output/result is available */
export interface ToolOutputAvailableEvent {
  type: 'tool-output-available';
  toolCallId: string;
  output: unknown;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Tool execution resulted in error */
export interface ToolOutputErrorEvent {
  type: 'tool-output-error';
  toolCallId: string;
  error: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

// ================================ Source =====================================

/** Base source event fields */
interface BaseSourceEvent {
  type: 'source';
  /** Unique source ID */
  id: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** URL source from web search or similar tools */
export interface SourceUrlEvent extends BaseSourceEvent {
  sourceType: 'url';
  /** URL of the source */
  url: string;
  /** Title of the source */
  title?: string;
}

/** Document source from file processing */
export interface SourceDocumentEvent extends BaseSourceEvent {
  sourceType: 'document';
  /** IANA media type (e.g., 'application/pdf') */
  mediaType: string;
  /** Title of the document */
  title: string;
  /** Filename of the document */
  filename?: string;
}

/** Source event - union of all source types */
export type SourceEvent = SourceUrlEvent | SourceDocumentEvent;

// =============================================================================
// OCTAVUS EVENTS (protocol-specific)
// =============================================================================

// --------------------------------- Block -------------------------------------

/** Protocol block execution started */
export interface BlockStartEvent {
  type: 'block-start';
  blockId: string;
  blockName: string;
  blockType: string;
  display: DisplayMode;
  description?: string;
  /** Whether output goes to main chat (false for independent blocks) */
  outputToChat?: boolean;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Protocol block execution completed */
export interface BlockEndEvent {
  type: 'block-end';
  blockId: string;
  summary?: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

/** Resource value updated */
export interface ResourceUpdateEvent {
  type: 'resource-update';
  name: string;
  value: unknown;
}

/** Pending tool call that needs external execution (continuation pattern) */
export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 'llm' for LLM-initiated, 'block' for protocol block */
  source?: 'llm' | 'block';
  /** For block-based tools: variable name to store result in */
  outputVariable?: string;
  /** For block-based tools: block index to resume from after execution */
  blockIndex?: number;
  /** Thread name where this tool call originated (for workers with threads) */
  thread?: string;
  /** Worker ID if this tool call originated from a worker execution */
  workerId?: string;
  /** Google Gemini 3 thought signature - required for tool call continuation */
  thoughtSignature?: string;
}

/**
 * When this event is received, the stream will close.
 * Consumer should execute the tools and POST a new trigger request with toolResults.
 */
export interface ToolRequestEvent {
  type: 'tool-request';
  toolCalls: PendingToolCall[];
  /** Worker ID if this tool request originated from a worker execution */
  workerId?: string;
}

/**
 * Request for client-side tool execution.
 * Emitted by server-SDK when a tool has no server handler registered.
 * Client should execute the tools and submit results via `continueWithToolResults(executionId, results)`.
 */
export interface ClientToolRequestEvent {
  type: 'client-tool-request';
  /**
   * Unique execution ID for this trigger execution.
   * Include this when sending tool results back to continue the execution.
   */
  executionId: string;
  toolCalls: PendingToolCall[];
  /**
   * Server tool results already executed in this round.
   * When mixed server+client tools are requested, the server executes its tools
   * first and includes results here. Client must include these when continuing.
   */
  serverToolResults?: ToolResult[];
}

/** Result from tool execution (consumer's response to tool-request) */
export interface ToolResult {
  toolCallId: string;
  toolName?: string;
  result?: unknown;
  error?: string;
  outputVariable?: string;
  blockIndex?: number;
  /** Thread name where this tool call originated (for workers with threads) */
  thread?: string;
  /** Worker ID if this tool result is for a worker execution */
  workerId?: string;
}

/**
 * A file generated during execution.
 * Used for skill outputs, image generation, code execution artifacts, etc.
 */
export interface GeneratedFile {
  /** Unique file ID */
  id: string;
  /** MIME type (e.g., 'image/png', 'application/pdf') */
  mediaType: string;
  /** URL for download/display */
  url: string;
  /** Original filename (for display/download) */
  filename?: string;
  /** Size in bytes */
  size?: number;
}

/**
 * File generated and available for download/display.
 * Emitted when a tool or skill produces a file output.
 */
export interface FileAvailableEvent {
  type: 'file-available';
  /** Unique file ID */
  id: string;
  /** MIME type (e.g., 'image/png', 'application/pdf') */
  mediaType: string;
  /** URL for download/display */
  url: string;
  /** Original filename */
  filename?: string;
  /** Size in bytes */
  size?: number;
  /** Tool call that generated this file */
  toolCallId?: string;
  /** Worker ID if this event originated from a worker execution */
  workerId?: string;
}

// --------------------------------- Worker ------------------------------------

/**
 * Worker execution has started.
 * Emitted when a worker begins execution (standalone or delegated from another agent).
 */
export interface WorkerStartEvent {
  type: 'worker-start';
  /** Unique ID for this worker invocation (correlates with worker-result, also used as session ID) */
  workerId: string;
  /** The worker's slug (agent identifier) */
  workerSlug: string;
  /** Display description for the worker execution */
  description?: string;
}

/**
 * Worker execution completed with output value.
 * Emitted by worker agents before the finish event when output is defined.
 */
export interface WorkerResultEvent {
  type: 'worker-result';
  /** Unique ID for this worker invocation (correlates with worker-start) */
  workerId: string;
  /** The worker's output value (undefined if no output variable defined) */
  output?: unknown;
  /** Error message if the worker failed */
  error?: string;
}

// =============================================================================
// Union of All Stream Events
// =============================================================================

export type StreamEvent =
  // Lifecycle events
  | StartEvent
  | FinishEvent
  | ErrorEvent
  // Text events
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  // Reasoning events
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  // Tool events
  | ToolInputStartEvent
  | ToolInputDeltaEvent
  | ToolInputEndEvent
  | ToolInputAvailableEvent
  | ToolOutputAvailableEvent
  | ToolOutputErrorEvent
  // Source events
  | SourceEvent
  // Octavus-specific events
  | BlockStartEvent
  | BlockEndEvent
  | ResourceUpdateEvent
  | ToolRequestEvent
  | ClientToolRequestEvent
  | FileAvailableEvent
  // Worker events
  | WorkerStartEvent
  | WorkerResultEvent;

// =============================================================================
// Message Types (Internal - used by platform/runtime)
// =============================================================================

/**
 * Type of content in a message part (internal)
 */
export type MessagePartType =
  | 'text'
  | 'reasoning'
  | 'tool-call'
  | 'operation'
  | 'source'
  | 'file'
  | 'object'
  | 'worker';

/**
 * Source info for URL sources (from web search, etc.)
 */
export interface SourceUrlInfo {
  sourceType: 'url';
  id: string;
  url: string;
  title?: string;
}

/**
 * Source info for document sources (from file processing)
 */
export interface SourceDocumentInfo {
  sourceType: 'document';
  id: string;
  mediaType: string;
  title: string;
  filename?: string;
}

/**
 * Source info - union of all source types (internal)
 */
export type SourceInfo = SourceUrlInfo | SourceDocumentInfo;

/**
 * File info for generated files (from skill execution, code execution, etc.)
 */
export interface FileInfo {
  id: string;
  mediaType: string;
  url: string;
  filename?: string;
  size?: number;
  toolCallId?: string;
}

/**
 * Object info for structured output (internal storage)
 */
export interface ObjectInfo {
  id: string;
  /** Type name from the protocol */
  typeName: string;
  /** The structured object value */
  value: unknown;
}

/**
 * Operation info for block operations (internal storage).
 * Used for operations like set-resource, serialize-thread, etc.
 */
export interface OperationInfo {
  /** Operation ID (same as block ID) */
  id: string;
  /** Human-readable name (from block name/description) */
  name: string;
  /** Type of operation (e.g., 'set-resource', 'serialize-thread') */
  operationType: string;
}

/**
 * Worker part info for worker execution (internal storage).
 * Stores nested parts generated by a worker, enabling parallel workers
 * and persistence across page refresh.
 */
export interface WorkerPartInfo {
  /** Unique ID for this worker invocation (also used as session ID for debug) */
  workerId: string;
  /** The worker's slug (agent identifier) */
  workerSlug: string;
  /** Display description for the worker */
  description?: string;
  /** Nested parts generated by the worker (text, reasoning, tool calls, etc.) */
  nestedParts: MessagePart[];
  /** Worker output value (when completed) */
  output?: unknown;
  /** Error message if worker failed */
  error?: string;
}

/**
 * A single part of a message, stored in order for proper display (internal)
 */
export interface MessagePart {
  type: MessagePartType;
  /** Whether shown in chat UI (false = LLM sees it, user doesn't) */
  visible: boolean;
  /** Content for text/reasoning parts */
  content?: string;
  /** Tool call info for tool-call parts */
  toolCall?: ToolCallInfo;
  /** Operation info for operation parts (block operations) */
  operation?: OperationInfo;
  /** Source info for source parts (from web search, etc.) */
  source?: SourceInfo;
  /** File info for file parts (from skill execution, etc.) */
  file?: FileInfo;
  /** Object info for object parts (structured output) */
  object?: ObjectInfo;
  /** Worker info for worker parts (worker execution container) */
  worker?: WorkerPartInfo;
  /** Thread name for non-main-thread content (e.g., "summary") */
  thread?: string;
}

/**
 * Tool result entry for tool continuation messages.
 * Used internally when injecting tool results back into conversation history.
 */
export interface ToolResultEntry {
  toolCallId: string;
  toolName?: string;
  result: unknown;
}

/**
 * Internal chat message - stored in session state, used by LLM
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Ordered parts for display - preserves reasoning/tool/text order */
  parts: MessagePart[];
  createdAt: string;
  /**
   * Whether shown in chat UI (false = LLM sees it, user doesn't).
   * Use for internal directives. Different from `display` which controls execution indicator.
   * @default true
   */
  visible?: boolean;

  // Flat fields derived from parts - kept for LLM context
  content: string;
  toolCalls?: ToolCallInfo[];
  reasoning?: string;
  /** Required by Anthropic to verify reasoning blocks */
  reasoningSignature?: string;
  /**
   * Tool results for continuation messages.
   * When present, this message represents tool results being injected back
   * into the conversation (converted to role: 'tool' for the AI SDK).
   */
  toolResults?: ToolResultEntry[];
}

// =============================================================================
// UI Message Types (Client-facing - used by SDKs and consumer apps)
// =============================================================================

/**
 * Status of a UI message
 */
export type UIMessageStatus = 'streaming' | 'done';

/**
 * Status of a UI message part
 */
export type UIPartStatus = 'streaming' | 'done';

/**
 * Text content in a UI message
 */
export interface UITextPart {
  type: 'text';
  text: string;
  status: UIPartStatus;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * Reasoning/thinking content in a UI message
 */
export interface UIReasoningPart {
  type: 'reasoning';
  text: string;
  status: UIPartStatus;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * Tool call status for UI
 */
export type UIToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

/**
 * Tool call in a UI message
 */
export interface UIToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  /** Human-readable display name (from protocol description) */
  displayName?: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: UIToolCallStatus;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * Operation status for UI
 */
export type UIOperationStatus = 'running' | 'done' | 'cancelled';

/**
 * Internal operation in a UI message (e.g., set-resource, serialize-thread)
 * These are Octavus-specific operations, not LLM tool calls
 */
export interface UIOperationPart {
  type: 'operation';
  operationId: string;
  /** Human-readable name (from block name/description) */
  name: string;
  /** Type of operation (e.g., 'set-resource', 'serialize-thread') */
  operationType: string;
  status: UIOperationStatus;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/** Base UI source part fields */
interface BaseUISourcePart {
  type: 'source';
  /** The ID of the source */
  id: string;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * URL source part (from web search results)
 */
export interface UISourceUrlPart extends BaseUISourcePart {
  sourceType: 'url';
  url: string;
  title?: string;
}

/**
 * Document source part (from file processing)
 */
export interface UISourceDocumentPart extends BaseUISourcePart {
  sourceType: 'document';
  mediaType: string;
  title: string;
  filename?: string;
}

/**
 * Source part - union of all source types
 */
export type UISourcePart = UISourceUrlPart | UISourceDocumentPart;

/**
 * File attachment part.
 * Generated by skill execution, image generation, code execution, etc.
 */
export interface UIFilePart {
  type: 'file';
  /** Unique file ID */
  id: string;
  /** MIME type (e.g., 'image/png', 'application/pdf') */
  mediaType: string;
  /** URL for download/display */
  url: string;
  /** Original filename (for display/download) */
  filename?: string;
  /** Size in bytes */
  size?: number;
  /** Tool call that generated this file */
  toolCallId?: string;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * Status of a UI object part
 */
export type UIObjectStatus = 'streaming' | 'done' | 'error';

/**
 * Structured object part in a UI message.
 * Used when the agent response is a typed object (structured output).
 * Client applications can render custom UI based on the typeName.
 */
export interface UIObjectPart {
  type: 'object';
  /** Unique part ID */
  id: string;
  /** The type name from the protocol (e.g., "ChatResponse") */
  typeName: string;
  /** Partial object while streaming (may have missing/incomplete fields) */
  partial?: unknown;
  /** Final validated object when done */
  object?: unknown;
  /** Current status */
  status: UIObjectStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Thread name (undefined or 'main' for main thread) */
  thread?: string;
}

/**
 * Status of a UI worker part
 */
export type UIWorkerStatus = 'running' | 'done' | 'error';

/**
 * Worker execution in a UI message.
 * Represents a nested worker agent execution with its own parts.
 * Used to display worker content in a dedicated container.
 */
export interface UIWorkerPart {
  type: 'worker';
  /** Unique ID for this worker invocation (correlates events, also used as session ID for debug) */
  workerId: string;
  /** The worker's slug (agent identifier) */
  workerSlug: string;
  /** Display description for the worker */
  description?: string;
  /** Nested parts generated by the worker */
  parts: UIMessagePart[];
  /** Worker output value (when done) */
  output?: unknown;
  /** Error message if worker failed */
  error?: string;
  /** Current status */
  status: UIWorkerStatus;
}

/**
 * Union of all UI message part types
 */
export type UIMessagePart =
  | UITextPart
  | UIReasoningPart
  | UIToolCallPart
  | UIOperationPart
  | UISourcePart
  | UIFilePart
  | UIObjectPart
  | UIWorkerPart;

/**
 * UI Message - the client-facing message format
 * All complexity is handled by the SDK, this is what consumers render
 */
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];
  status: UIMessageStatus;
  createdAt: Date;
}
