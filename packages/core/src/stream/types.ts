/**
 * The wire types, inferred from the schemas in `schemas.ts` (the single
 * definition of every shape), plus the tool-provider interfaces the SDKs share.
 *
 * Events are organized into two categories:
 * - Standard Events (====): Common streaming patterns for AI agents
 * - Octavus Events (----): Octavus-specific protocol events
 */

import type { z } from 'zod';
import type {
  Wire,
  displayModeSchema,
  finishReasonSchema,
  fileReferenceSchema,
  todoItemStatusSchema,
  todoItemSchema,
  uiMessageSenderSchema,
  startEventSchema,
  finishEventSchema,
  errorEventSchema,
  textStartEventSchema,
  textDeltaEventSchema,
  textEndEventSchema,
  reasoningStartEventSchema,
  reasoningDeltaEventSchema,
  reasoningEndEventSchema,
  toolInputStartEventSchema,
  toolInputDeltaEventSchema,
  toolInputEndEventSchema,
  toolInputAvailableEventSchema,
  toolOutputAvailableEventSchema,
  toolOutputErrorEventSchema,
  sourceUrlEventSchema,
  sourceDocumentEventSchema,
  todoUpdateEventSchema,
  blockStartEventSchema,
  blockEndEventSchema,
  stepStartEventSchema,
  stepDiscardEventSchema,
  persistedEventSchema,
  pendingToolCallSchema,
  toolResultSchema,
  toolRequestEventSchema,
  clientToolRequestEventSchema,
  fileAvailableEventSchema,
  workerStartEventSchema,
  workerResultEventSchema,
  workerInputStartEventSchema,
  workerInputDeltaEventSchema,
  workerInputReadyEventSchema,
  workerExecutionCostSchema,
  workerExecutionTokensSchema,
  usageEventSchema,
  streamEventSchema,
  uiMessageStatusSchema,
  uiPartStatusSchema,
  uiToolCallStatusSchema,
  uiOperationStatusSchema,
  uiObjectStatusSchema,
  uiWorkerStatusSchema,
  uiTextPartSchema,
  uiReasoningPartSchema,
  uiToolCallPartSchema,
  uiOperationPartSchema,
  uiSourceUrlPartSchema,
  uiSourceDocumentPartSchema,
  uiFilePartSchema,
  uiObjectPartSchema,
  uiTodoItemSchema,
  uiTodoPartSchema,
  uiStepStartPartSchema,
  uiUnknownPartSchema,
  uiWorkerPartObjectSchema,
  uiMessageObjectSchema,
} from './schemas';

export type { UnknownStreamEvent, StreamEventParseResult } from './schemas';

/**
 * Display mode - what the client sees of an entity's execution (not whether
 * the entity's final message is visible):
 * - `hidden` - nothing; the client never knows it ran.
 * - `title` - the label and errors only. The label is the authored `title`,
 *   else a label derived from the entity's identity (see `getPartLabel`);
 *   arguments, results, worker input and output, and nested activity stay
 *   out of the client's reach. The default for tools, MCP servers, skills,
 *   and operation-style blocks.
 * - `stream` - everything, live. The default for workers and the
 *   `next-message` and `run-worker` blocks.
 */
export type DisplayMode = z.infer<typeof displayModeSchema>;

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolHandlers = Record<string, ToolHandler>;

/** Schema for a runtime-discovered tool (device MCP tools, etc.) */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Optional JSON Schema describing the tool's return shape.
   * Forwarded to the LLM as `outputSchema` when the underlying provider
   * supports structured tool outputs (e.g. OpenAI strict mode). Discovered
   * from MCP servers that declare `outputSchema` per the MCP spec.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * When true, this tool suspends the turn instead of being executed. The
   * runtime surfaces it as a pending tool call whose result is delivered by an
   * external event (a coordination hub), and the turn stays open across the
   * suspension - the resident executor holds the pending call until the event
   * arrives, then continues. This is the seam for hosting a long-lived
   * interaction (e.g. a real-time session) inside one continuous turn.
   */
  suspend?: boolean;
  /**
   * Optional UI label for this tool's execution card. For inline (consumer) MCP
   * tools this is a per-tool override of the namespace-level `title`; the
   * runtime prefers it over the `mcpServers.<ns>` title. The label a client
   * shows is `title ?? label(toolName)`.
   */
  title?: string;
  /**
   * Optional per-tool display mode. For inline (consumer) MCP tools this
   * overrides the namespace-level `display`; unset falls back to the namespace
   * mode, then the runtime default.
   */
  display?: DisplayMode;
}

/** A runtime-discovered tool pairing a schema with an execution handler. */
export interface DynamicTool {
  schema: ToolSchema;
  handler: ToolHandler;
}

/**
 * Interface for providing namespaced tools to a session.
 * Implementors include `@octavus/computer` (browser, filesystem, shell)
 * and custom consumer-defined tool providers.
 */
export interface ToolProvider {
  toolHandlers(): Record<string, ToolHandler>;
  toolSchemas(): ToolSchema[];
}

/**
 * An MCP server defined inline in the consumer's process.
 * Tools are Zod-typed and execute in the consumer's server via the
 * tool-request/continue pattern. The namespace prefixes all tool names
 * with `namespace__toolName` to avoid collisions.
 */
export interface InlineMcpServer extends ToolProvider {
  readonly namespace: string;
}

/** Health status for a single MCP entry (namespace). */
export interface EntryHealth {
  name: string;
  healthy: boolean;
  error?: string;
}

/** Aggregate health status for all entries managed by a device. */
export interface ComputerHealth {
  healthy: boolean;
  entries: EntryHealth[];
  totalTools: number;
}

/** Result of an ensureReady call, including recovery details. */
export interface EnsureReadyResult extends ComputerHealth {
  recovered?: string[];
  failedEntries?: string[];
}

/**
 * Extended ToolProvider for device-backed tool surfaces.
 * Adds health checking and recovery on top of basic tool provision.
 */
export interface DeviceProvider extends ToolProvider {
  getHealth(): Promise<ComputerHealth>;
  ensureReady(): Promise<EnsureReadyResult>;
}

export function isDeviceProvider(provider: ToolProvider): provider is DeviceProvider {
  return 'getHealth' in provider && 'ensureReady' in provider;
}

/**
 * Description of a STDIO MCP entry that can be added dynamically to a provider.
 * Mirrors the public `Computer.stdio()` factory output shape.
 */
export interface DynamicStdioEntry {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Optional capability that lets consumers add or remove MCP entries on a
 * running provider after construction. Implemented by `@octavus/computer`'s
 * `Computer` class, used by session-managers that receive per-session MCP
 * configurations from the dispatch payload.
 */
export interface DynamicMcpProvider {
  addEntry(
    namespace: string,
    entry: DynamicStdioEntry,
    options?: { deferred?: boolean },
  ): Promise<void>;
  removeEntry(namespace: string): Promise<void>;
  restartEntry(namespace: string): Promise<void>;
  hasEntry(namespace: string): boolean;
}

export function isDynamicMcpProvider(
  provider: ToolProvider,
): provider is ToolProvider & DynamicMcpProvider {
  return (
    'addEntry' in provider &&
    'removeEntry' in provider &&
    'restartEntry' in provider &&
    'hasEntry' in provider
  );
}

/**
 * Reference to an uploaded file.
 * Used in trigger input, user messages, and tool results for file attachments.
 * Compatible with UIFilePart structure for rendering. `width` and `height` are
 * the image's true pixel dimensions, recorded at ingestion when the raster
 * bytes were in hand, so the runtime can tell whether an image fits a declared
 * `maxImageDimension` without fetching it.
 */
export type FileReference = Wire<z.infer<typeof fileReferenceSchema>>;

// =============================================================================
// STANDARD EVENTS
// =============================================================================

// ============================== Lifecycle ====================================

/**
 * Signals the start of a response message.
 *
 * `messageId` is the id of the assistant message this execution's output lands
 * on - the id the message is persisted under, so a client that builds the
 * message live can key it the same way a reload does. `executionId` identifies
 * the execution for tool continuation; `lastMessageId` is the last message in
 * session state before this execution (for retry rollback); `sessionId` lets a
 * create-and-trigger caller learn the new session id from the first event.
 */
export type StartEvent = Wire<z.infer<typeof startEventSchema>>;

/**
 * Signals the end of a stream.
 *
 * `finishReason: 'continue'` means the execution is not finished: the server
 * ended this leg of it and resumes the same execution on the next `continue`
 * request for its `executionId` with an empty `toolResults` list - the same
 * continuation the `tool-calls` finish uses, with nothing to run first. The
 * server SDK performs that continuation itself, so its consumers see one
 * uninterrupted stream.
 */
export type FinishEvent = Wire<z.infer<typeof finishEventSchema>>;

/**
 * Error during streaming, with its classification (`errorType`), where it
 * originated (`source`), whether a retry can help (`retryable`, `retryAfter`),
 * the platform's stable `code`, the `requestId` to quote to support, and the
 * provider, tool, or backup-model details when they apply.
 */
export type ErrorEvent = Wire<z.infer<typeof errorEventSchema>>;

export type FinishReason = z.infer<typeof finishReasonSchema>;

// ================================= Text ======================================

/**
 * Start of text generation for a specific text part. If `responseType` is set,
 * the text content is JSON matching a custom type and the client SDK parses it
 * as a structured object instead of displaying it as plain text.
 */
export type TextStartEvent = Wire<z.infer<typeof textStartEventSchema>>;
/** Incremental text content */
export type TextDeltaEvent = Wire<z.infer<typeof textDeltaEventSchema>>;
/** End of text generation for a specific text part */
export type TextEndEvent = Wire<z.infer<typeof textEndEventSchema>>;

// =============================== Reasoning ===================================

export type ReasoningStartEvent = Wire<z.infer<typeof reasoningStartEventSchema>>;
export type ReasoningDeltaEvent = Wire<z.infer<typeof reasoningDeltaEventSchema>>;
export type ReasoningEndEvent = Wire<z.infer<typeof reasoningEndEventSchema>>;

// ================================= Tool ======================================

/**
 * Tool call initiated. Carries the tool's identity (`toolName`), its authored
 * `title` when it has one, and its `display`. Input streaming follows only in
 * `stream` mode.
 */
export type ToolInputStartEvent = Wire<z.infer<typeof toolInputStartEventSchema>>;
/** Incremental tool input/arguments (`stream` mode only) */
export type ToolInputDeltaEvent = Wire<z.infer<typeof toolInputDeltaEventSchema>>;
/** Tool input streaming has ended */
export type ToolInputEndEvent = Wire<z.infer<typeof toolInputEndEventSchema>>;
/** Tool input is complete; `input` is `{}` unless the display mode is `stream`. */
export type ToolInputAvailableEvent = Wire<z.infer<typeof toolInputAvailableEventSchema>>;
/** Tool output is available; `output` is `undefined` unless the display mode is `stream`. */
export type ToolOutputAvailableEvent = Wire<z.infer<typeof toolOutputAvailableEventSchema>>;
/** Tool execution resulted in error. Emitted in every visible display mode. */
export type ToolOutputErrorEvent = Wire<z.infer<typeof toolOutputErrorEventSchema>>;

// ================================= Todo ======================================

export type TodoItemStatus = z.infer<typeof todoItemStatusSchema>;
export type TodoItem = Wire<z.infer<typeof todoItemSchema>>;
/** Full TODO list update (carries resolved snapshot) */
export type TodoUpdateEvent = Wire<z.infer<typeof todoUpdateEventSchema>>;

// ================================ Source =====================================

/** URL source from web search or similar tools */
export type SourceUrlEvent = Wire<z.infer<typeof sourceUrlEventSchema>>;
/** Document source from file processing */
export type SourceDocumentEvent = Wire<z.infer<typeof sourceDocumentEventSchema>>;
/** Source event - union of all source types */
export type SourceEvent = SourceUrlEvent | SourceDocumentEvent;

// =============================================================================
// OCTAVUS EVENTS (protocol-specific)
// =============================================================================

// --------------------------------- Block -------------------------------------

/**
 * Protocol block execution started. `operation` is true for a block that
 * renders as an operation card; `title` is the block's authored title.
 */
export type BlockStartEvent = Wire<z.infer<typeof blockStartEventSchema>>;
/** Protocol block execution completed */
export type BlockEndEvent = Wire<z.infer<typeof blockEndEventSchema>>;

// --------------------------------- Step --------------------------------------

/**
 * A new model step is starting inside a block that already streamed output in
 * an earlier step of the same turn (a multi-step agentic response). The live
 * counterpart of the persisted `step-start` message part: clients that mirror
 * the wire into `parts[]` insert the same structural marker, so a message
 * built live matches the message reloaded from history. Carries no payload
 * and renders nothing. Not emitted for a block's first step.
 */
export type StepStartEvent = Wire<z.infer<typeof stepStartEventSchema>>;

/**
 * The current step's partial output is abandoned: everything streamed since
 * the step began (its reasoning, text, and tool inputs - after the last
 * `step-start`, or since the block's output began for a first step) must be
 * discarded. Emitted when the runtime rolls a step back to re-issue it, for
 * example after a transient provider failure interrupted the stream before
 * anything from the step had executed; a fresh attempt at the same step
 * streams next. Output committed by earlier steps is untouched. Clients that
 * do not understand this event keep the abandoned output visible and simply
 * see the retried step appended after it.
 */
export type StepDiscardEvent = Wire<z.infer<typeof stepDiscardEventSchema>>;

// ------------------------------- Persisted -----------------------------------

/**
 * Everything streamed before this event is now in persisted session state.
 * Emitted once per continuation round, after the round's state write and
 * before the tool request that pauses the execution. `round` counts the
 * persisted rounds of this execution (1 after the first). A client that holds
 * a snapshot of persisted state can use the matching marker as the point from
 * which the live stream still has to be applied; a replay that begins at a
 * marker rewinds only what was streamed after it. Carries no visible content.
 */
export type PersistedEvent = Wire<z.infer<typeof persistedEventSchema>>;

// --------------------------------- Tool --------------------------------------

/**
 * A tool call that needs an external executor: the consumer's server, the
 * browser, or the agent's computer. Carries the call's `display`, so the
 * executor's own output events reveal only what the mode allows.
 */
export type PendingToolCall = Wire<z.infer<typeof pendingToolCallSchema>>;

/**
 * When this event is received, the stream will close. The executor runs the
 * tools it owns and submits their results on the execution's `continue`.
 */
export type ToolRequestEvent = Wire<z.infer<typeof toolRequestEventSchema>>;

/**
 * Request for client-side tool execution, emitted by the server SDK for the
 * calls no server handler claimed. The client runs them and submits only their
 * results through the consumer's `continue` passthrough.
 */
export type ClientToolRequestEvent = Wire<z.infer<typeof clientToolRequestEventSchema>>;

/** A tool's result, submitted by the executor that ran it. */
export type ToolResult = Wire<z.infer<typeof toolResultSchema>>;

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
 * Emitted when a tool or skill produces a file output, in every display mode.
 */
export type FileAvailableEvent = Wire<z.infer<typeof fileAvailableEventSchema>>;

// --------------------------------- Worker ------------------------------------

/**
 * Worker execution has started. Carries the worker's identity (`workerSlug`),
 * its authored `title`, and its `display`; `input` only in `stream` mode.
 */
export type WorkerStartEvent = Wire<z.infer<typeof workerStartEventSchema>>;

/**
 * Worker execution completed. `output` is present only in `stream` mode; an
 * `error` is reported in every visible mode.
 */
export type WorkerResultEvent = Wire<z.infer<typeof workerResultEventSchema>>;

/**
 * Early signal that a worker invocation is starting and its input will stream
 * progressively. Emitted for workers with display `stream` invoked agentically
 * (LLM tool call) before the LLM has finished generating the input arguments.
 *
 * Lets the client create the `UIWorkerPart` immediately, then populate its
 * input via the subsequent `worker-input-delta` and `worker-input-ready` events.
 * The runtime still emits the regular `worker-start` event when execution
 * begins, so clients that don't handle this event continue to work unchanged.
 */
export type WorkerInputStartEvent = Wire<z.infer<typeof workerInputStartEventSchema>>;
/** Incremental worker input arguments streamed as the LLM generates them (`stream` mode). */
export type WorkerInputDeltaEvent = Wire<z.infer<typeof workerInputDeltaEventSchema>>;
/** Worker input is complete and execution is starting (`stream` mode). */
export type WorkerInputReadyEvent = Wire<z.infer<typeof workerInputReadyEventSchema>>;

// --------------------------------- Usage -------------------------------------

/**
 * Dollar cost of a single worker execution, in `currency`. Provider cost is
 * pass-through (Octavus adds no markup); the only Octavus-added charge is the
 * bandwidth (platform) fee. `providerFee` is `0` when your own provider key
 * (BYOK) was used; `estimatedProviderFee` is then what the models would have
 * cost on Octavus keys.
 */
export type WorkerExecutionCost = Wire<z.infer<typeof workerExecutionCostSchema>>;
/** Token totals for a worker execution, summed across all steps. */
export type WorkerExecutionTokens = Wire<z.infer<typeof workerExecutionTokensSchema>>;
/**
 * Per-execution usage and cost summary, emitted once when a worker execution
 * completes (after `worker-result` / `finish`, before the stream closes).
 */
export type UsageEvent = Wire<z.infer<typeof usageEventSchema>>;

// =============================================================================
// Union of All Stream Events
// =============================================================================

/**
 * Every stream event this version of the contract knows. A stream can carry
 * events of types added later, which the parser keeps as `UnknownStreamEvent`
 * and the server SDK forwards: switch on `type` with a `default` branch.
 */
export type StreamEvent = Wire<z.infer<typeof streamEventSchema>>;

// =============================================================================
// UI Message Types (Client-facing - used by SDKs and consumer apps)
// =============================================================================

export type UIMessageStatus = z.infer<typeof uiMessageStatusSchema>;
export type UIPartStatus = z.infer<typeof uiPartStatusSchema>;
export type UIToolCallStatus = z.infer<typeof uiToolCallStatusSchema>;
export type UIOperationStatus = z.infer<typeof uiOperationStatusSchema>;
export type UIObjectStatus = z.infer<typeof uiObjectStatusSchema>;
export type UIWorkerStatus = z.infer<typeof uiWorkerStatusSchema>;

/** Text content in a UI message */
export type UITextPart = Wire<z.infer<typeof uiTextPartSchema>>;
/** Reasoning/thinking content in a UI message */
export type UIReasoningPart = Wire<z.infer<typeof uiReasoningPartSchema>>;
/**
 * Tool call in a UI message. The card's label is `getPartLabel(part)`: the
 * authored `title`, else a label for `toolName`. `args` is `{}` and `result`
 * absent unless `display` is `stream`.
 */
export type UIToolCallPart = Wire<z.infer<typeof uiToolCallPartSchema>>;
/**
 * A protocol block that renders as an operation card (e.g. `generate-image`,
 * `serialize-thread`). `name` is the block's name; the label is
 * `getPartLabel(part)`.
 */
export type UIOperationPart = Wire<z.infer<typeof uiOperationPartSchema>>;
/** URL source part (from web search results) */
export type UISourceUrlPart = Wire<z.infer<typeof uiSourceUrlPartSchema>>;
/** Document source part (from file processing) */
export type UISourceDocumentPart = Wire<z.infer<typeof uiSourceDocumentPartSchema>>;
/** Source part - union of all source types */
export type UISourcePart = UISourceUrlPart | UISourceDocumentPart;
/** File attachment part, generated by skill execution, image generation, code execution, etc. */
export type UIFilePart = Wire<z.infer<typeof uiFilePartSchema>>;
/**
 * Structured object part in a UI message, used when the agent response is a
 * typed object. Client applications can render custom UI based on `typeName`.
 */
export type UIObjectPart = Wire<z.infer<typeof uiObjectPartSchema>>;
/** Todo item in a UI message (mirrors TodoItem for client consumption) */
export type UITodoItem = Wire<z.infer<typeof uiTodoItemSchema>>;
/** Todo list part in a UI message, an evolving task list the agent updates in real time. */
export type UITodoPart = Wire<z.infer<typeof uiTodoPartSchema>>;
/**
 * Step boundary marker between LLM steps in a multi-step agentic response.
 * Carries no payload and is not rendered.
 */
export type UIStepStartPart = Wire<z.infer<typeof uiStepStartPartSchema>>;

/**
 * A part whose `type` this version of the contract does not know. Kept in
 * `UIMessage.parts` at runtime so it round-trips through persistence and
 * `restore`; not a member of `UIMessagePart`, so renderers that switch on
 * `type` skip it in their `default` branch.
 */
export type UIUnknownPart = Wire<z.infer<typeof uiUnknownPartSchema>>;

/**
 * Worker execution in a UI message: a nested worker agent execution with its
 * own parts. The label is `getPartLabel(part)`; `input`, `output`, and nested
 * `parts` are present only when `display` is `stream`.
 */
export type UIWorkerPart = Omit<Wire<z.infer<typeof uiWorkerPartObjectSchema>>, 'parts'> & {
  parts: UIMessagePart[];
};

/**
 * Union of all UI message part types this version of the contract knows.
 */
export type UIMessagePart =
  | UITextPart
  | UIReasoningPart
  | UIToolCallPart
  | UIOperationPart
  | UISourcePart
  | UIFilePart
  | UIObjectPart
  | UIWorkerPart
  | UITodoPart
  | UIStepStartPart;

/**
 * Identity of the human who sent a user message.
 *
 * Optional and only meaningful on `role: 'user'` messages. Apps where
 * several people share one conversation with an agent can populate this so
 * the UI can attribute each message to its author (name + avatar). Assistant
 * messages never carry a sender.
 */
export type UIMessageSender = Wire<z.infer<typeof uiMessageSenderSchema>>;

/**
 * UI Message - the client-facing message format. All complexity is handled by
 * the SDK, this is what consumers render and persist. `createdAt` is an ISO
 * 8601 timestamp.
 */
export type UIMessage = Omit<Wire<z.infer<typeof uiMessageObjectSchema>>, 'parts'> & {
  parts: UIMessagePart[];
};
