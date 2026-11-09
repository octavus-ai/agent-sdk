/**
 * The wire types, plus the tool-provider interfaces the SDKs share. Each wire
 * type is written out here and must equal what its schema in `schemas.ts`
 * parses to (`schema-type-checks.ts` fails the type check otherwise), so the
 * published types never depend on zod.
 *
 * Events are organized into two categories:
 * - Standard Events (====): Common streaming patterns for AI agents
 * - Octavus Events (----): Octavus-specific protocol events
 */

/* eslint-disable @typescript-eslint/consistent-type-definitions -- the wire types are type aliases: a wire value keeps fields this version does not know, and an interface would stop it being assignable to `Record<string, unknown>` */

import type {
  BackupFailureInfo,
  ErrorSource,
  ErrorType,
  ProviderErrorInfo,
  ToolErrorInfo,
} from '@/errors/types';

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
export type DisplayMode = 'hidden' | 'title' | 'stream';

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
 * Tools are typed by their schemas and execute in the consumer's server via
 * the tool-request/continue pattern. The namespace prefixes all tool names
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
export type FileReference = {
  id: string;
  mediaType: string;
  url: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
};

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
export type StartEvent = {
  type: 'start';
  messageId?: string;
  executionId?: string;
  lastMessageId?: string;
  sessionId?: string;
};

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
export type FinishEvent = {
  type: 'finish';
  finishReason: FinishReason;
  executionId?: string;
};

/**
 * Error during streaming, with its classification (`errorType`), where it
 * originated (`source`), whether a retry can help (`retryable`, `retryAfter`),
 * the platform's stable `code`, the `requestId` to quote to support, and the
 * provider, tool, or backup-model details when they apply.
 */
export type ErrorEvent = {
  type: 'error';
  errorType: ErrorType;
  message: string;
  retryable: boolean;
  source: ErrorSource;
  retryAfter?: number;
  code?: string;
  requestId?: string;
  provider?: ProviderErrorInfo;
  tool?: ToolErrorInfo;
  backup?: BackupFailureInfo;
};

export type FinishReason =
  | 'stop'
  | 'tool-calls'
  | 'client-tool-calls'
  | 'continue'
  | 'length'
  | 'content-filter'
  | 'error'
  | 'other';

// ================================= Text ======================================

/**
 * Start of text generation for a specific text part. If `responseType` is set,
 * the text content is JSON matching a custom type and the client SDK parses it
 * as a structured object instead of displaying it as plain text.
 */
export type TextStartEvent = {
  type: 'text-start';
  id: string;
  responseType?: string;
  workerId?: string;
};
/** Incremental text content */
export type TextDeltaEvent = {
  type: 'text-delta';
  id: string;
  delta: string;
  workerId?: string;
};
/** End of text generation for a specific text part */
export type TextEndEvent = {
  type: 'text-end';
  id: string;
  workerId?: string;
};

// =============================== Reasoning ===================================

export type ReasoningStartEvent = {
  type: 'reasoning-start';
  id: string;
  workerId?: string;
};
export type ReasoningDeltaEvent = {
  type: 'reasoning-delta';
  id: string;
  delta: string;
  workerId?: string;
};
export type ReasoningEndEvent = {
  type: 'reasoning-end';
  id: string;
  workerId?: string;
};

// ================================= Tool ======================================

/**
 * Tool call initiated. Carries the tool's identity (`toolName`), its authored
 * `title` when it has one, and its `display`. Input streaming follows only in
 * `stream` mode.
 */
export type ToolInputStartEvent = {
  type: 'tool-input-start';
  toolCallId: string;
  toolName: string;
  /** The authored title of the tool, when it has one. The label is `title ?? label(toolName)`. */
  title?: string;
  display?: DisplayMode;
  workerId?: string;
};
/** Incremental tool input/arguments (`stream` mode only) */
export type ToolInputDeltaEvent = {
  type: 'tool-input-delta';
  toolCallId: string;
  inputTextDelta: string;
  display?: DisplayMode;
  workerId?: string;
};
/** Tool input streaming has ended */
export type ToolInputEndEvent = {
  type: 'tool-input-end';
  toolCallId: string;
  workerId?: string;
};
/** Tool input is complete; `input` is `{}` unless the display mode is `stream`. */
export type ToolInputAvailableEvent = {
  type: 'tool-input-available';
  toolCallId: string;
  toolName: string;
  input: unknown;
  display?: DisplayMode;
  workerId?: string;
};
/** Tool output is available; `output` is `undefined` unless the display mode is `stream`. */
export type ToolOutputAvailableEvent = {
  type: 'tool-output-available';
  toolCallId: string;
  output: unknown;
  display?: DisplayMode;
  workerId?: string;
};
/** Tool execution resulted in error. Emitted in every visible display mode. */
export type ToolOutputErrorEvent = {
  type: 'tool-output-error';
  toolCallId: string;
  error: string;
  display?: DisplayMode;
  workerId?: string;
};

// ================================= Todo ======================================

export type TodoItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoItem = {
  id: string;
  content: string;
  status: TodoItemStatus;
};
/** Full TODO list update (carries resolved snapshot) */
export type TodoUpdateEvent = {
  type: 'todo-update';
  todos: TodoItem[];
  workerId?: string;
};

// ================================ Source =====================================

/** URL source from web search or similar tools */
export type SourceUrlEvent = {
  type: 'source';
  sourceType: 'url';
  id: string;
  url: string;
  title?: string;
  workerId?: string;
};
/** Document source from file processing */
export type SourceDocumentEvent = {
  type: 'source';
  sourceType: 'document';
  id: string;
  mediaType: string;
  title: string;
  filename?: string;
  workerId?: string;
};
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
export type BlockStartEvent = {
  type: 'block-start';
  blockId: string;
  blockName: string;
  blockType: string;
  display: DisplayMode;
  /** The block's authored title, when it has one. */
  title?: string;
  /** True when the block renders as an operation card. */
  operation?: boolean;
  outputToChat?: boolean;
  thread?: string;
  workerId?: string;
};
/** Protocol block execution completed */
export type BlockEndEvent = {
  type: 'block-end';
  blockId: string;
  summary?: string;
  workerId?: string;
};

// --------------------------------- Step --------------------------------------

/**
 * A new model step is starting inside a block that already streamed output in
 * an earlier step of the same turn (a multi-step agentic response). The live
 * counterpart of the persisted `step-start` message part: clients that mirror
 * the wire into `parts[]` insert the same structural marker, so a message
 * built live matches the message reloaded from history. Carries no payload
 * and renders nothing. Not emitted for a block's first step.
 */
export type StepStartEvent = {
  type: 'step-start';
  workerId?: string;
};

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
export type StepDiscardEvent = {
  type: 'step-discard';
  workerId?: string;
};

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
export type PersistedEvent = {
  type: 'persisted';
  executionId: string;
  round: number;
  messageId?: string;
};

// --------------------------------- Tool --------------------------------------

/**
 * A tool call that needs an external executor: the consumer's server, the
 * browser, or the agent's computer. Carries the call's `display`, so the
 * executor's own output events reveal only what the mode allows.
 */
export type PendingToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The call's display mode; what the executor's own output events may reveal. */
  display?: DisplayMode;
  /** Thread name where this tool call originated (for workers with threads) */
  thread?: string;
  /** Worker ID if this tool call originated from a worker execution */
  workerId?: string;
  /**
   * True when this pending call suspends the turn awaiting an external event
   * (see `ToolSchema.suspend`) rather than a device/client tool execution. The
   * resident executor must hold the call open and resolve it with the event
   * delivered by the coordination hub, not reject or execute it locally.
   */
  suspend?: boolean;
  /**
   * For a suspending call, the identity of the interaction it awaits (set by
   * the tool that opened the interaction). The resident executor matches the
   * events it is handed against it, so an event from an interaction that already
   * closed never resolves a park waiting on the next one. Absent when the
   * opening tool declared no identity.
   */
  interactionId?: string;
};

/**
 * When this event is received, the stream will close. The executor runs the
 * tools it owns and submits their results on the execution's `continue`.
 */
export type ToolRequestEvent = {
  type: 'tool-request';
  toolCalls: PendingToolCall[];
  workerId?: string;
};

/**
 * Request for client-side tool execution, emitted by the server SDK for the
 * calls no server handler claimed. The client runs them and submits only their
 * results through the consumer's `continue` passthrough.
 */
export type ClientToolRequestEvent = {
  type: 'client-tool-request';
  executionId: string;
  toolCalls: PendingToolCall[];
};

/** A tool's result, submitted by the executor that ran it. */
export type ToolResult = {
  toolCallId: string;
  result?: unknown;
  error?: string;
  /** Files produced by the tool (e.g., screenshots, generated images). */
  files?: FileReference[];
  /**
   * True when the executor reduced the result to a preview because it was too
   * large to send. The platform refuses a reduced result for a call whose
   * result a `tool-call` block captures into a variable.
   */
  truncated?: boolean;
};

/**
 * File generated and available for download/display.
 * Emitted when a tool or skill produces a file output, in every display mode.
 */
export type FileAvailableEvent = {
  type: 'file-available';
  id: string;
  mediaType: string;
  url: string;
  filename?: string;
  size?: number;
  toolCallId?: string;
  workerId?: string;
};

// --------------------------------- Worker ------------------------------------

/**
 * Worker execution has started. Carries the worker's identity (`workerSlug`),
 * its authored `title`, and its `display`; `input` only in `stream` mode.
 */
export type WorkerStartEvent = {
  type: 'worker-start';
  workerId: string;
  workerSlug: string;
  /** The worker's authored title, when it has one. */
  title?: string;
  display?: DisplayMode;
  /** Worker input values; present only when the display mode is `stream`. */
  input?: Record<string, unknown>;
};

/**
 * Worker execution completed. `output` is present only in `stream` mode; an
 * `error` is reported in every visible mode.
 */
export type WorkerResultEvent = {
  type: 'worker-result';
  workerId: string;
  /** The worker's output value; present only when the display mode is `stream`. */
  output?: unknown;
  error?: string;
  cancelled?: boolean;
};

/**
 * Early signal that a worker invocation is starting and its input will stream
 * progressively. Emitted for workers with display `stream` invoked agentically
 * (LLM tool call) before the LLM has finished generating the input arguments.
 *
 * Lets the client create the `UIWorkerPart` immediately, then populate its
 * input via the subsequent `worker-input-delta` and `worker-input-ready` events.
 * The runtime still emits the regular `worker-start` event when execution
 * begins, so a client that does not handle this event works without it.
 */
export type WorkerInputStartEvent = {
  type: 'worker-input-start';
  workerId: string;
  workerSlug: string;
  title?: string;
  display?: DisplayMode;
};
/** Incremental worker input arguments streamed as the LLM generates them (`stream` mode). */
export type WorkerInputDeltaEvent = {
  type: 'worker-input-delta';
  workerId: string;
  delta: string;
};
/** Worker input is complete and execution is starting (`stream` mode). */
export type WorkerInputReadyEvent = {
  type: 'worker-input-ready';
  workerId: string;
  input: Record<string, unknown>;
};

// --------------------------------- Usage -------------------------------------

/**
 * Dollar cost of a single worker execution, in `currency`. Provider cost is
 * pass-through (Octavus adds no markup); the only Octavus-added charge is the
 * bandwidth (platform) fee. `providerFee` is `0` when your own provider key
 * (BYOK) was used; `estimatedProviderFee` is then what the models would have
 * cost on Octavus keys.
 */
export type WorkerExecutionCost = {
  currency: string;
  bandwidthFee: number;
  providerFee: number;
  totalFee: number;
  byok: boolean;
  estimatedProviderFee?: number;
};
/** Token totals for a worker execution, summed across all steps. */
export type WorkerExecutionTokens = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
/**
 * Per-execution usage and cost summary, emitted once when a worker execution
 * completes (after `worker-result` / `finish`, before the stream closes).
 */
export type UsageEvent = {
  type: 'usage';
  cost: WorkerExecutionCost;
  tokens: WorkerExecutionTokens;
};

// =============================================================================
// Union of All Stream Events
// =============================================================================

/**
 * Every stream event this version of the contract knows. A stream can carry
 * events of types added later, which the parser keeps as `UnknownStreamEvent`
 * and the server SDK forwards: switch on `type` with a `default` branch that
 * ignores the value, never an exhaustiveness check.
 */
export type StreamEvent =
  | StartEvent
  | FinishEvent
  | ErrorEvent
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolInputStartEvent
  | ToolInputDeltaEvent
  | ToolInputEndEvent
  | ToolInputAvailableEvent
  | ToolOutputAvailableEvent
  | ToolOutputErrorEvent
  | SourceEvent
  | TodoUpdateEvent
  | BlockStartEvent
  | BlockEndEvent
  | StepStartEvent
  | StepDiscardEvent
  | PersistedEvent
  | ToolRequestEvent
  | ClientToolRequestEvent
  | FileAvailableEvent
  | WorkerStartEvent
  | WorkerResultEvent
  | WorkerInputStartEvent
  | WorkerInputDeltaEvent
  | WorkerInputReadyEvent
  | UsageEvent;

/** An event whose `type` this version of the contract does not know. */
export type UnknownStreamEvent = {
  type: string;
};

/** One reason a value is not a valid wire shape: the failing path and its message. */
export interface WireParseIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Why a value is not a valid wire shape: each failing path and its message. */
export interface WireParseError extends Error {
  readonly issues: readonly WireParseIssue[];
}

export type StreamEventParseResult =
  /** An event this contract knows, with any extra fields kept. */
  | { kind: 'event'; event: StreamEvent }
  /** An event of a type this contract does not know: forward it, or ignore it. */
  | { kind: 'unknown'; event: UnknownStreamEvent }
  /** Not an event: no string `type`, or a known type whose fields do not validate. */
  | { kind: 'invalid'; error: WireParseError };

/** The result of `safeParseUIMessage` and `safeParseUIMessages`. */
export type WireParseResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: WireParseError };

// =============================================================================
// UI Message Types (Client-facing - used by SDKs and consumer apps)
// =============================================================================

export type UIMessageStatus = 'streaming' | 'done';
export type UIPartStatus = 'streaming' | 'done';
export type UIToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';
export type UIOperationStatus = 'running' | 'done' | 'cancelled';
export type UIObjectStatus = 'streaming' | 'done' | 'error';
export type UIWorkerStatus = 'running' | 'done' | 'error' | 'cancelled';

/** Text content in a UI message */
export type UITextPart = {
  type: 'text';
  text: string;
  status: UIPartStatus;
  thread?: string;
  providerMetadata?: Record<string, unknown>;
};
/** Reasoning/thinking content in a UI message */
export type UIReasoningPart = {
  type: 'reasoning';
  text: string;
  status: UIPartStatus;
  thread?: string;
  providerMetadata?: Record<string, unknown>;
};
/**
 * Tool call in a UI message. The card's label is `getPartLabel(part)`: the
 * authored `title`, else a label for `toolName`. `args` is `{}` and `result`
 * absent unless `display` is `stream`.
 */
export type UIToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  /** The tool's authored title, when it has one. See `getPartLabel`. */
  title?: string;
  /** The arguments; `{}` unless the display mode is `stream`. */
  args: Record<string, unknown>;
  /** The result; present only when the display mode is `stream`. */
  result?: unknown;
  error?: string;
  status: UIToolCallStatus;
  display?: DisplayMode;
  thread?: string;
  providerMetadata?: Record<string, unknown>;
};
/**
 * A protocol block that renders as an operation card (e.g. `generate-image`,
 * `serialize-thread`). `name` is the block's name; the label is
 * `getPartLabel(part)`.
 */
export type UIOperationPart = {
  type: 'operation';
  operationId: string;
  /** The block's name, as authored in the protocol. */
  name: string;
  /** The block type, e.g. `generate-image`. */
  operationType: string;
  /** The block's authored title, when it has one. See `getPartLabel`. */
  title?: string;
  display?: DisplayMode;
  status: UIOperationStatus;
  thread?: string;
};
/** URL source part (from web search results) */
export type UISourceUrlPart = {
  type: 'source';
  sourceType: 'url';
  id: string;
  url: string;
  title?: string;
  thread?: string;
};
/** Document source part (from file processing) */
export type UISourceDocumentPart = {
  type: 'source';
  sourceType: 'document';
  id: string;
  mediaType: string;
  title: string;
  filename?: string;
  thread?: string;
};
/** Source part - union of all source types */
export type UISourcePart = UISourceUrlPart | UISourceDocumentPart;
/** File attachment part, generated by skill execution, image generation, code execution, etc. */
export type UIFilePart = {
  type: 'file';
  id: string;
  mediaType: string;
  url: string;
  filename?: string;
  size?: number;
  toolCallId?: string;
  thread?: string;
};
/**
 * Structured object part in a UI message, used when the agent response is a
 * typed object. Client applications can render custom UI based on `typeName`.
 */
export type UIObjectPart = {
  type: 'object';
  id: string;
  typeName: string;
  partial?: unknown;
  object?: unknown;
  status: UIObjectStatus;
  error?: string;
  thread?: string;
};
/** Todo item in a UI message (mirrors TodoItem for client consumption) */
export type UITodoItem = {
  id: string;
  content: string;
  status: TodoItemStatus;
};
/** Todo list part in a UI message, an evolving task list the agent updates in real time. */
export type UITodoPart = {
  type: 'todo';
  todos: UITodoItem[];
  status: UIPartStatus;
  thread?: string;
};
/**
 * Step boundary marker between LLM steps in a multi-step agentic response.
 * Carries no payload and is not rendered.
 */
export type UIStepStartPart = {
  type: 'step-start';
};

/**
 * A part whose `type` this version of the contract does not know. Kept in
 * `UIMessage.parts` at runtime so it round-trips through persistence and
 * `restore`; not a member of `UIMessagePart`, so renderers that switch on
 * `type` skip it in their `default` branch.
 */
export type UIUnknownPart = {
  type: string;
};

/**
 * Worker execution in a UI message: a nested worker agent execution with its
 * own parts. The label is `getPartLabel(part)`; `input`, `output`, and nested
 * `parts` are present only when `display` is `stream`.
 */
export type UIWorkerPart = {
  type: 'worker';
  workerId: string;
  workerSlug: string;
  /** The worker's authored title, when it has one. See `getPartLabel`. */
  title?: string;
  display?: DisplayMode;
  /** Worker input values; present only when the display mode is `stream`. */
  input?: Record<string, unknown>;
  parts: UIMessagePart[];
  /** Worker output value; present only when the display mode is `stream`. */
  output?: unknown;
  error?: string;
  status: UIWorkerStatus;
};

/**
 * Union of all UI message part types this version of the contract knows. A
 * message can carry parts of types added later (see `UIUnknownPart`): switch
 * on `type` with a `default` branch that ignores the value, never an
 * exhaustiveness check.
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
export type UIMessageSender = {
  id?: string;
  name?: string;
  image?: string;
};

/**
 * UI Message - the client-facing message format. All complexity is handled by
 * the SDK, this is what consumers render and persist.
 */
export type UIMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];
  status: UIMessageStatus;
  /** When the message was created, as an ISO 8601 timestamp. */
  createdAt: string;
  sender?: UIMessageSender;
};
