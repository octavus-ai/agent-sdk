/**
 * The wire contract: every stream event, UI message part, and request/response
 * shape the platform and the SDKs exchange, defined once as Zod schemas. The
 * TypeScript types in `types.ts` are inferred from these schemas.
 *
 * The contract is additive, so the parsers are tolerant: every object keeps
 * the fields it does not know, every enum falls back to a defined value when it
 * meets one it does not know (and reports it, see `setUnknownWireValueReporter`),
 * and an event or part of an unknown `type` is kept rather than dropped. The
 * `type` discriminators themselves stay closed: the TypeScript unions are the
 * known shapes, and a reader switches on `type` with a `default` branch.
 *
 * Schemas are organized into two categories:
 * - Standard Events (====): Common streaming patterns for AI agents
 * - Octavus Events (----): Octavus-specific protocol events
 */

import { z } from 'zod';
import type { StreamEvent, UIMessage, UIMessagePart, UIWorkerPart } from './types';

// =============================================================================
// Tolerance
// =============================================================================

/** An enum value the wire carried that this version of the contract does not know. */
export interface UnknownWireValue {
  /** The enum, e.g. `display` or `finishReason`. */
  field: string;
  /** The value received. */
  value: unknown;
  /** The value it was read as. */
  fallback: string;
}

export type UnknownWireValueReporter = (unknown: UnknownWireValue) => void;

const reportedWireValues = new Set<string>();

/**
 * The default reporter: warns once per field and value, so a typo in an emitter
 * or a value from a newer server surfaces in the console without flooding it.
 */
const defaultUnknownWireValueReporter: UnknownWireValueReporter = (unknown) => {
  const key = `${unknown.field}:${String(unknown.value)}`;
  if (reportedWireValues.has(key)) return;
  reportedWireValues.add(key);
  // eslint-disable-next-line no-console -- the one place an unknown wire value is made visible
  console.warn(
    `[octavus] Unknown ${unknown.field} value ${JSON.stringify(unknown.value)}; reading it as ${JSON.stringify(unknown.fallback)}.`,
  );
};

let unknownWireValueReporter: UnknownWireValueReporter | null = defaultUnknownWireValueReporter;

/**
 * Replace how unknown enum values are reported (pass `null` to silence them).
 * Call it once at startup to route them into your own telemetry.
 */
export function setUnknownWireValueReporter(reporter: UnknownWireValueReporter | null): void {
  unknownWireValueReporter = reporter;
}

/**
 * An enum that reads an unknown value as `fallback` instead of rejecting the
 * whole event or part, reporting the value so it does not pass unnoticed. A
 * missing or non-string value still fails: tolerance is for values added
 * later, not for malformed input.
 */
function tolerantEnum<const T extends readonly [string, ...string[]]>(
  field: string,
  values: T,
  fallback: T[number],
) {
  const known: ReadonlySet<string> = new Set(values);
  return z.string().transform((value): T[number] => {
    if (known.has(value)) return value as T[number];
    unknownWireValueReporter?.({ field, value, fallback });
    return fallback;
  });
}

type StripIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * The type a wire schema describes, without the index signatures its loose
 * objects infer: the exported types name the known fields only, while the
 * parsers keep whatever else arrives. Applied through arrays and nested
 * objects; a plain record (`Record<string, unknown>`) is left as it is.
 */
export type Wire<T> = T extends readonly (infer U)[]
  ? Wire<U>[]
  : T extends object
    ? keyof StripIndexSignature<T> extends never
      ? T
      : { [K in keyof StripIndexSignature<T>]: Wire<StripIndexSignature<T>[K]> }
    : T;

// =============================================================================
// Shared values
// =============================================================================

/**
 * What a client sees of an entity's execution:
 * - `hidden` - nothing; the client never knows it ran.
 * - `title` - the label (the authored `title`, else a label derived from the
 *   entity's identity) and errors only. Arguments, results, worker input and
 *   output, and nested activity stay out of the client's reach.
 * - `stream` - everything, live.
 */
export const displayModeSchema = tolerantEnum('display', ['hidden', 'title', 'stream'], 'title');

export const finishReasonSchema = tolerantEnum(
  'finishReason',
  [
    'stop',
    'tool-calls',
    'client-tool-calls',
    'continue',
    'length',
    'content-filter',
    'error',
    'other',
  ],
  'other',
);

export const errorTypeSchema = tolerantEnum(
  'errorType',
  [
    'authentication_error',
    'permission_error',
    'validation_error',
    'not_found_error',
    'conflict_error',
    'rate_limit_error',
    'quota_exceeded_error',
    'provider_error',
    'provider_overloaded',
    'provider_timeout',
    'unsupported_error',
    'execution_error',
    'tool_error',
    'protocol_error',
    'internal_error',
    'unknown_error',
  ],
  'unknown_error',
);

export const errorSourceSchema = tolerantEnum(
  'errorSource',
  ['platform', 'provider', 'tool', 'client'],
  'platform',
);

export const todoItemStatusSchema = tolerantEnum(
  'todoItemStatus',
  ['pending', 'in_progress', 'completed', 'cancelled'],
  'pending',
);

export const todoItemSchema = z.looseObject({
  id: z.string(),
  content: z.string(),
  status: todoItemStatusSchema,
});

/**
 * An image's pixel width or height, when the producer recorded it. Tolerant: a
 * malformed value is dropped rather than rejecting the whole reference, so a
 * caller that sends a stray value is not refused over an optional hint.
 */
const imageDimensionSchema = z.number().int().positive().optional().catch(undefined);

/**
 * Reference to an uploaded file, used in trigger input, user messages, and
 * tool results.
 */
export const fileReferenceSchema = z.looseObject({
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  width: imageDimensionSchema,
  height: imageDimensionSchema,
});

export const uiMessageSenderSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  image: z.string().optional(),
});

// =============================================================================
// STANDARD EVENTS
// =============================================================================

// ============================== Lifecycle ====================================

export const startEventSchema = z.looseObject({
  type: z.literal('start'),
  messageId: z.string().optional(),
  executionId: z.string().optional(),
  lastMessageId: z.string().optional(),
  sessionId: z.string().optional(),
});

export const finishEventSchema = z.looseObject({
  type: z.literal('finish'),
  finishReason: finishReasonSchema,
  executionId: z.string().optional(),
});

export const providerErrorInfoSchema = z.looseObject({
  name: z.string(),
  model: z.string().optional(),
  statusCode: z.number().optional(),
  errorType: z.string().optional(),
  requestId: z.string().optional(),
  details: z.string().optional(),
  upstream: z.string().optional(),
});

export const toolErrorInfoSchema = z.looseObject({
  name: z.string(),
  callId: z.string().optional(),
});

export const backupFailureInfoSchema = z.looseObject({
  model: z.string(),
  errorType: errorTypeSchema,
  message: z.string(),
  code: z.string().optional(),
  provider: providerErrorInfoSchema.optional(),
  attempts: z.number().int().positive().optional(),
});

export const errorEventSchema = z.looseObject({
  type: z.literal('error'),
  errorType: errorTypeSchema,
  message: z.string(),
  retryable: z.boolean(),
  source: errorSourceSchema,
  retryAfter: z.number().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  provider: providerErrorInfoSchema.optional(),
  tool: toolErrorInfoSchema.optional(),
  backup: backupFailureInfoSchema.optional(),
});

// ================================= Text ======================================

export const textStartEventSchema = z.looseObject({
  type: z.literal('text-start'),
  id: z.string(),
  responseType: z.string().optional(),
  workerId: z.string().optional(),
});

export const textDeltaEventSchema = z.looseObject({
  type: z.literal('text-delta'),
  id: z.string(),
  delta: z.string(),
  workerId: z.string().optional(),
});

export const textEndEventSchema = z.looseObject({
  type: z.literal('text-end'),
  id: z.string(),
  workerId: z.string().optional(),
});

// =============================== Reasoning ===================================

export const reasoningStartEventSchema = z.looseObject({
  type: z.literal('reasoning-start'),
  id: z.string(),
  workerId: z.string().optional(),
});

export const reasoningDeltaEventSchema = z.looseObject({
  type: z.literal('reasoning-delta'),
  id: z.string(),
  delta: z.string(),
  workerId: z.string().optional(),
});

export const reasoningEndEventSchema = z.looseObject({
  type: z.literal('reasoning-end'),
  id: z.string(),
  workerId: z.string().optional(),
});

// ================================= Tool ======================================

export const toolInputStartEventSchema = z.looseObject({
  type: z.literal('tool-input-start'),
  toolCallId: z.string(),
  toolName: z.string(),
  /** The authored title of the tool, when it has one. The label is `title ?? label(toolName)`. */
  title: z.string().optional(),
  display: displayModeSchema.optional(),
  workerId: z.string().optional(),
});

export const toolInputDeltaEventSchema = z.looseObject({
  type: z.literal('tool-input-delta'),
  toolCallId: z.string(),
  inputTextDelta: z.string(),
  display: displayModeSchema.optional(),
  workerId: z.string().optional(),
});

export const toolInputEndEventSchema = z.looseObject({
  type: z.literal('tool-input-end'),
  toolCallId: z.string(),
  workerId: z.string().optional(),
});

export const toolInputAvailableEventSchema = z.looseObject({
  type: z.literal('tool-input-available'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  display: displayModeSchema.optional(),
  workerId: z.string().optional(),
});

export const toolOutputAvailableEventSchema = z.looseObject({
  type: z.literal('tool-output-available'),
  toolCallId: z.string(),
  output: z.unknown(),
  display: displayModeSchema.optional(),
  workerId: z.string().optional(),
});

export const toolOutputErrorEventSchema = z.looseObject({
  type: z.literal('tool-output-error'),
  toolCallId: z.string(),
  error: z.string(),
  display: displayModeSchema.optional(),
  workerId: z.string().optional(),
});

// ================================ Source =====================================

export const sourceUrlEventSchema = z.looseObject({
  type: z.literal('source'),
  sourceType: z.literal('url'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  workerId: z.string().optional(),
});

export const sourceDocumentEventSchema = z.looseObject({
  type: z.literal('source'),
  sourceType: z.literal('document'),
  id: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
  workerId: z.string().optional(),
});

export const sourceEventSchema = z.discriminatedUnion('sourceType', [
  sourceUrlEventSchema,
  sourceDocumentEventSchema,
]);

// ---------------------------------- Todo -------------------------------------

export const todoUpdateEventSchema = z.looseObject({
  type: z.literal('todo-update'),
  todos: z.array(todoItemSchema),
  workerId: z.string().optional(),
});

// =============================================================================
// OCTAVUS EVENTS (protocol-specific)
// =============================================================================

// --------------------------------- Block -------------------------------------

export const blockStartEventSchema = z.looseObject({
  type: z.literal('block-start'),
  blockId: z.string(),
  blockName: z.string(),
  blockType: z.string(),
  display: displayModeSchema,
  /** The block's authored title, when it has one. */
  title: z.string().optional(),
  /** True when the block renders as an operation card. */
  operation: z.boolean().optional(),
  outputToChat: z.boolean().optional(),
  thread: z.string().optional(),
  workerId: z.string().optional(),
});

export const blockEndEventSchema = z.looseObject({
  type: z.literal('block-end'),
  blockId: z.string(),
  summary: z.string().optional(),
  workerId: z.string().optional(),
});

// --------------------------------- Step --------------------------------------

export const stepStartEventSchema = z.looseObject({
  type: z.literal('step-start'),
  workerId: z.string().optional(),
});

export const stepDiscardEventSchema = z.looseObject({
  type: z.literal('step-discard'),
  workerId: z.string().optional(),
});

// ------------------------------- Persisted -----------------------------------

export const persistedEventSchema = z.looseObject({
  type: z.literal('persisted'),
  executionId: z.string(),
  round: z.number().int().nonnegative(),
  messageId: z.string().optional(),
});

// --------------------------------- Tool --------------------------------------

export const pendingToolCallSchema = z.looseObject({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  /** The call's display mode; what the executor's own output events may reveal. */
  display: displayModeSchema.optional(),
  /** Thread name where this tool call originated (for workers with threads) */
  thread: z.string().optional(),
  /** Worker ID if this tool call originated from a worker execution */
  workerId: z.string().optional(),
  /**
   * True when this pending call suspends the turn awaiting an external event
   * (see `ToolSchema.suspend`) rather than a device/client tool execution. The
   * resident executor must hold the call open and resolve it with the event
   * delivered by the coordination hub, not reject or execute it locally.
   */
  suspend: z.boolean().optional(),
  /**
   * For a suspending call, the identity of the interaction it awaits (set by
   * the tool that opened the interaction). The resident executor matches the
   * events it is handed against it, so an event from an interaction that already
   * closed never resolves a park waiting on the next one. Absent when the
   * opening tool declared no identity.
   */
  interactionId: z.string().optional(),
});

/** A tool's result, submitted by the executor that ran it. */
export const toolResultSchema = z.looseObject({
  toolCallId: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  /** Files produced by the tool (e.g., screenshots, generated images). */
  files: z.array(fileReferenceSchema).optional(),
});

export const toolRequestEventSchema = z.looseObject({
  type: z.literal('tool-request'),
  toolCalls: z.array(pendingToolCallSchema),
  workerId: z.string().optional(),
});

export const clientToolRequestEventSchema = z.looseObject({
  type: z.literal('client-tool-request'),
  executionId: z.string(),
  toolCalls: z.array(pendingToolCallSchema),
});

export const fileAvailableEventSchema = z.looseObject({
  type: z.literal('file-available'),
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  toolCallId: z.string().optional(),
  workerId: z.string().optional(),
});

// --------------------------------- Worker ------------------------------------

export const workerStartEventSchema = z.looseObject({
  type: z.literal('worker-start'),
  workerId: z.string(),
  workerSlug: z.string(),
  /** The worker's authored title, when it has one. */
  title: z.string().optional(),
  display: displayModeSchema.optional(),
  /** Worker input values; present only when the display mode is `stream`. */
  input: z.record(z.string(), z.unknown()).optional(),
});

export const workerResultEventSchema = z.looseObject({
  type: z.literal('worker-result'),
  workerId: z.string(),
  /** The worker's output value; present only when the display mode is `stream`. */
  output: z.unknown().optional(),
  error: z.string().optional(),
  cancelled: z.boolean().optional(),
});

export const workerInputStartEventSchema = z.looseObject({
  type: z.literal('worker-input-start'),
  workerId: z.string(),
  workerSlug: z.string(),
  title: z.string().optional(),
  display: displayModeSchema.optional(),
});

export const workerInputDeltaEventSchema = z.looseObject({
  type: z.literal('worker-input-delta'),
  workerId: z.string(),
  delta: z.string(),
});

export const workerInputReadyEventSchema = z.looseObject({
  type: z.literal('worker-input-ready'),
  workerId: z.string(),
  input: z.record(z.string(), z.unknown()),
});

// --------------------------------- Usage -------------------------------------

export const workerExecutionCostSchema = z.looseObject({
  currency: z.string(),
  bandwidthFee: z.number(),
  providerFee: z.number(),
  totalFee: z.number(),
  byok: z.boolean(),
  estimatedProviderFee: z.number().optional(),
});

export const workerExecutionTokensSchema = z.looseObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

export const usageEventSchema = z.looseObject({
  type: z.literal('usage'),
  cost: workerExecutionCostSchema,
  tokens: workerExecutionTokensSchema,
});

// =============================================================================
// Union of all stream events
// =============================================================================

/**
 * Every stream event this version of the contract knows. The parser
 * (`safeParseStreamEvent`) dispatches on `type`, so an event of an unknown type
 * is kept as an `UnknownStreamEvent` instead of failing this union.
 */
export const streamEventSchema = z.discriminatedUnion('type', [
  // Lifecycle events
  startEventSchema,
  finishEventSchema,
  errorEventSchema,
  // Text events
  textStartEventSchema,
  textDeltaEventSchema,
  textEndEventSchema,
  // Reasoning events
  reasoningStartEventSchema,
  reasoningDeltaEventSchema,
  reasoningEndEventSchema,
  // Tool events
  toolInputStartEventSchema,
  toolInputDeltaEventSchema,
  toolInputEndEventSchema,
  toolInputAvailableEventSchema,
  toolOutputAvailableEventSchema,
  toolOutputErrorEventSchema,
  // Source events
  sourceEventSchema,
  // Todo events
  todoUpdateEventSchema,
  // Octavus-specific events
  blockStartEventSchema,
  blockEndEventSchema,
  stepStartEventSchema,
  stepDiscardEventSchema,
  persistedEventSchema,
  toolRequestEventSchema,
  clientToolRequestEventSchema,
  fileAvailableEventSchema,
  // Worker events
  workerStartEventSchema,
  workerResultEventSchema,
  workerInputStartEventSchema,
  workerInputDeltaEventSchema,
  workerInputReadyEventSchema,
  // Usage events
  usageEventSchema,
]);

/** An event whose `type` this version of the contract does not know. */
export const unknownStreamEventSchema = z.looseObject({ type: z.string() });

const streamEventSchemaByType: Record<string, z.ZodType> = {
  start: startEventSchema,
  finish: finishEventSchema,
  error: errorEventSchema,
  'text-start': textStartEventSchema,
  'text-delta': textDeltaEventSchema,
  'text-end': textEndEventSchema,
  'reasoning-start': reasoningStartEventSchema,
  'reasoning-delta': reasoningDeltaEventSchema,
  'reasoning-end': reasoningEndEventSchema,
  'tool-input-start': toolInputStartEventSchema,
  'tool-input-delta': toolInputDeltaEventSchema,
  'tool-input-end': toolInputEndEventSchema,
  'tool-input-available': toolInputAvailableEventSchema,
  'tool-output-available': toolOutputAvailableEventSchema,
  'tool-output-error': toolOutputErrorEventSchema,
  source: sourceEventSchema,
  'todo-update': todoUpdateEventSchema,
  'block-start': blockStartEventSchema,
  'block-end': blockEndEventSchema,
  'step-start': stepStartEventSchema,
  'step-discard': stepDiscardEventSchema,
  persisted: persistedEventSchema,
  'tool-request': toolRequestEventSchema,
  'client-tool-request': clientToolRequestEventSchema,
  'file-available': fileAvailableEventSchema,
  'worker-start': workerStartEventSchema,
  'worker-result': workerResultEventSchema,
  'worker-input-start': workerInputStartEventSchema,
  'worker-input-delta': workerInputDeltaEventSchema,
  'worker-input-ready': workerInputReadyEventSchema,
  usage: usageEventSchema,
};

/** An event whose `type` this version of the contract does not know. */
export type UnknownStreamEvent = Wire<z.infer<typeof unknownStreamEventSchema>>;

export type StreamEventParseResult =
  /** An event this contract knows, with any extra fields kept. */
  | { kind: 'event'; event: StreamEvent }
  /** An event of a type this contract does not know: forward it, or ignore it. */
  | { kind: 'unknown'; event: UnknownStreamEvent }
  /** Not an event: no string `type`, or a known type whose fields do not validate. */
  | { kind: 'invalid'; error: z.ZodError };

/**
 * Parse one stream event tolerantly: a known `type` validates against its
 * schema (keeping unknown fields), an unknown `type` is kept as an unknown
 * event, and only a malformed known event or a non-event is invalid.
 */
export function safeParseStreamEvent(data: unknown): StreamEventParseResult {
  const envelope = unknownStreamEventSchema.safeParse(data);
  if (!envelope.success) {
    return { kind: 'invalid', error: envelope.error };
  }
  const schema = streamEventSchemaByType[envelope.data.type];
  if (!schema) {
    return { kind: 'unknown', event: envelope.data };
  }
  const result = schema.safeParse(data);
  return result.success
    ? { kind: 'event', event: result.data as StreamEvent }
    : { kind: 'invalid', error: result.error };
}

// =============================================================================
// UI Message Types (used by SDKs and consumer apps)
// =============================================================================

export const uiMessageStatusSchema = tolerantEnum(
  'uiMessageStatus',
  ['streaming', 'done'],
  'streaming',
);
export const uiPartStatusSchema = tolerantEnum('uiPartStatus', ['streaming', 'done'], 'streaming');
export const uiToolCallStatusSchema = tolerantEnum(
  'uiToolCallStatus',
  ['pending', 'running', 'done', 'error', 'cancelled'],
  'running',
);
export const uiOperationStatusSchema = tolerantEnum(
  'uiOperationStatus',
  ['running', 'done', 'cancelled'],
  'running',
);
export const uiObjectStatusSchema = tolerantEnum(
  'uiObjectStatus',
  ['streaming', 'done', 'error'],
  'streaming',
);
export const uiWorkerStatusSchema = tolerantEnum(
  'uiWorkerStatus',
  ['running', 'done', 'error', 'cancelled'],
  'running',
);

const uiProviderMetadataSchema = z.record(z.string(), z.unknown()).optional();

export const uiTextPartSchema = z.looseObject({
  type: z.literal('text'),
  text: z.string(),
  status: uiPartStatusSchema,
  thread: z.string().optional(),
  providerMetadata: uiProviderMetadataSchema,
});

export const uiReasoningPartSchema = z.looseObject({
  type: z.literal('reasoning'),
  text: z.string(),
  status: uiPartStatusSchema,
  thread: z.string().optional(),
  providerMetadata: uiProviderMetadataSchema,
});

export const uiToolCallPartSchema = z.looseObject({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  /** The tool's authored title, when it has one. See `getPartLabel`. */
  title: z.string().optional(),
  /** The arguments; `{}` unless the display mode is `stream`. */
  args: z.record(z.string(), z.unknown()),
  /** The result; present only when the display mode is `stream`. */
  result: z.unknown().optional(),
  error: z.string().optional(),
  status: uiToolCallStatusSchema,
  display: displayModeSchema.optional(),
  thread: z.string().optional(),
  providerMetadata: uiProviderMetadataSchema,
});

export const uiOperationPartSchema = z.looseObject({
  type: z.literal('operation'),
  operationId: z.string(),
  /** The block's name, as authored in the protocol. */
  name: z.string(),
  /** The block type, e.g. `generate-image`. */
  operationType: z.string(),
  /** The block's authored title, when it has one. See `getPartLabel`. */
  title: z.string().optional(),
  display: displayModeSchema.optional(),
  status: uiOperationStatusSchema,
  thread: z.string().optional(),
});

export const uiSourceUrlPartSchema = z.looseObject({
  type: z.literal('source'),
  sourceType: z.literal('url'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  thread: z.string().optional(),
});

export const uiSourceDocumentPartSchema = z.looseObject({
  type: z.literal('source'),
  sourceType: z.literal('document'),
  id: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
  thread: z.string().optional(),
});

export const uiSourcePartSchema = z.discriminatedUnion('sourceType', [
  uiSourceUrlPartSchema,
  uiSourceDocumentPartSchema,
]);

export const uiFilePartSchema = z.looseObject({
  type: z.literal('file'),
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  toolCallId: z.string().optional(),
  thread: z.string().optional(),
});

export const uiObjectPartSchema = z.looseObject({
  type: z.literal('object'),
  id: z.string(),
  typeName: z.string(),
  partial: z.unknown().optional(),
  object: z.unknown().optional(),
  status: uiObjectStatusSchema,
  error: z.string().optional(),
  thread: z.string().optional(),
});

export const uiTodoItemSchema = z.looseObject({
  id: z.string(),
  content: z.string(),
  status: todoItemStatusSchema,
});

export const uiTodoPartSchema = z.looseObject({
  type: z.literal('todo'),
  todos: z.array(uiTodoItemSchema),
  status: uiPartStatusSchema,
  thread: z.string().optional(),
});

// Step boundary marker. No payload, no UI rendering - preserves step
// structure across UIMessage <-> ChatMessage round-trips so multi-step
// reasoning rebuilds into one assistant + tool model message per step.
export const uiStepStartPartSchema = z.looseObject({
  type: z.literal('step-start'),
});

const KNOWN_UI_PART_TYPES = new Set([
  'text',
  'reasoning',
  'tool-call',
  'operation',
  'source',
  'file',
  'object',
  'worker',
  'todo',
  'step-start',
]);

/**
 * A part whose `type` this version of the contract does not know. Kept in
 * `UIMessage.parts` so it round-trips through persistence and `restore`;
 * renderers skip it. A part of a known type that fails its schema is not an
 * unknown part: it fails the message.
 */
export const uiUnknownPartSchema = z.looseObject({
  type: z.string().refine((type) => !KNOWN_UI_PART_TYPES.has(type)),
});

// Base parts schema (without worker, for non-recursive use). A discriminated
// union validates only the member the `type` names, so an unknown enum value
// is reported once, by the schema that owns it.
const baseUiMessagePartSchema = z.union([
  z.discriminatedUnion('type', [
    uiTextPartSchema,
    uiReasoningPartSchema,
    uiToolCallPartSchema,
    uiOperationPartSchema,
    uiSourcePartSchema,
    uiFilePartSchema,
    uiObjectPartSchema,
    uiTodoPartSchema,
    uiStepStartPartSchema,
  ]),
  uiUnknownPartSchema,
]);

// Worker part schema with nested parts (uses base schema to avoid infinite recursion)
export const uiWorkerPartObjectSchema = z.looseObject({
  type: z.literal('worker'),
  workerId: z.string(),
  workerSlug: z.string(),
  /** The worker's authored title, when it has one. See `getPartLabel`. */
  title: z.string().optional(),
  display: displayModeSchema.optional(),
  /** Worker input values; present only when the display mode is `stream`. */
  input: z.record(z.string(), z.unknown()).optional(),
  // Worker parts can contain base parts (text, reasoning, tools, etc.) but not nested workers
  parts: z.array(baseUiMessagePartSchema),
  /** Worker output value; present only when the display mode is `stream`. */
  output: z.unknown().optional(),
  error: z.string().optional(),
  status: uiWorkerStatusSchema,
});

/**
 * Parses a worker part. Typed with the known part shape: an unknown nested part
 * is kept at runtime (see `uiUnknownPartSchema`), so a reader of `parts`
 * switches on `type` with a `default` branch.
 */
export const uiWorkerPartSchema = uiWorkerPartObjectSchema as unknown as z.ZodType<UIWorkerPart>;

/**
 * Every UI message part: the known parts, plus an unknown part for a type this
 * contract does not know (see `uiUnknownPartSchema`).
 */
const uiMessagePartUnionSchema = z.union([
  z.discriminatedUnion('type', [
    uiTextPartSchema,
    uiReasoningPartSchema,
    uiToolCallPartSchema,
    uiOperationPartSchema,
    uiSourcePartSchema,
    uiFilePartSchema,
    uiObjectPartSchema,
    uiWorkerPartObjectSchema,
    uiTodoPartSchema,
    uiStepStartPartSchema,
  ]),
  uiUnknownPartSchema,
]);

/**
 * Parses one UI message part. Typed with the known parts: an unknown part is
 * kept at runtime, so a reader switches on `type` with a `default` branch.
 */
export const uiMessagePartSchema = uiMessagePartUnionSchema as unknown as z.ZodType<UIMessagePart>;

export const uiMessageObjectSchema = z.looseObject({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(uiMessagePartUnionSchema),
  status: uiMessageStatusSchema,
  /** When the message was created, as an ISO 8601 timestamp. */
  createdAt: z.string(),
  sender: uiMessageSenderSchema.optional(),
});

/**
 * Parses a UI message tolerantly: unknown fields are kept, unknown enum values
 * fall back, and parts of an unknown type are kept in `parts` (typed as the
 * known parts; readers switch on `type` with a `default` branch).
 */
export const uiMessageSchema = uiMessageObjectSchema as unknown as z.ZodType<UIMessage>;

export function safeParseUIMessage(data: unknown) {
  return uiMessageSchema.safeParse(data);
}

export function safeParseUIMessages(data: unknown) {
  return z.array(uiMessageSchema).safeParse(data);
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a FileReference object.
 */
export function isFileReference(
  value: unknown,
): value is Wire<z.infer<typeof fileReferenceSchema>> {
  return fileReferenceSchema.safeParse(value).success;
}

/**
 * Type guard to check if a value is an array of FileReference objects.
 */
export function isFileReferenceArray(
  value: unknown,
): value is Wire<z.infer<typeof fileReferenceSchema>>[] {
  return z.array(fileReferenceSchema).safeParse(value).success;
}
