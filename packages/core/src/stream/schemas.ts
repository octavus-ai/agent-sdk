/**
 * Zod schemas for stream events.
 *
 * Schemas are organized into two categories:
 * - Standard Events (====): Common streaming patterns for AI agents
 * - Octavus Events (----): Octavus-specific protocol events
 */

import { z } from 'zod';

export const displayModeSchema = z.enum(['hidden', 'name', 'description', 'stream']);
export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);
export const toolCallStatusSchema = z.enum(['pending', 'streaming', 'available', 'error']);
export const finishReasonSchema = z.enum([
  'stop',
  'tool-calls',
  'client-tool-calls',
  'length',
  'content-filter',
  'error',
  'other',
]);

export const toolCallInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()),
  status: toolCallStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
});

// =============================================================================
// STANDARD EVENTS
// =============================================================================

// ============================== Lifecycle ====================================

export const startEventSchema = z.object({
  type: z.literal('start'),
  messageId: z.string().optional(),
  executionId: z.string().optional(),
});

export const finishEventSchema = z.object({
  type: z.literal('finish'),
  finishReason: finishReasonSchema,
  executionId: z.string().optional(),
});

const errorTypeSchema = z.enum([
  'authentication_error',
  'permission_error',
  'validation_error',
  'not_found_error',
  'rate_limit_error',
  'quota_exceeded_error',
  'provider_error',
  'provider_overloaded',
  'provider_timeout',
  'execution_error',
  'tool_error',
  'protocol_error',
  'internal_error',
  'unknown_error',
]);

const errorSourceSchema = z.enum(['platform', 'provider', 'tool', 'client']);

const providerErrorInfoSchema = z.object({
  name: z.string(),
  model: z.string().optional(),
  statusCode: z.number().optional(),
  errorType: z.string().optional(),
  requestId: z.string().optional(),
});

const toolErrorInfoSchema = z.object({
  name: z.string(),
  callId: z.string().optional(),
});

export const errorEventSchema = z.object({
  type: z.literal('error'),
  errorType: errorTypeSchema,
  message: z.string(),
  retryable: z.boolean(),
  source: errorSourceSchema,
  retryAfter: z.number().optional(),
  code: z.string().optional(),
  provider: providerErrorInfoSchema.optional(),
  tool: toolErrorInfoSchema.optional(),
});

// ================================= Text ======================================

export const textStartEventSchema = z.object({
  type: z.literal('text-start'),
  id: z.string(),
  responseType: z.string().optional(),
});

export const textDeltaEventSchema = z.object({
  type: z.literal('text-delta'),
  id: z.string(),
  delta: z.string(),
});

export const textEndEventSchema = z.object({
  type: z.literal('text-end'),
  id: z.string(),
});

// =============================== Reasoning ===================================

export const reasoningStartEventSchema = z.object({
  type: z.literal('reasoning-start'),
  id: z.string(),
});

export const reasoningDeltaEventSchema = z.object({
  type: z.literal('reasoning-delta'),
  id: z.string(),
  delta: z.string(),
});

export const reasoningEndEventSchema = z.object({
  type: z.literal('reasoning-end'),
  id: z.string(),
});

// ================================= Tool ======================================

export const toolInputStartEventSchema = z.object({
  type: z.literal('tool-input-start'),
  toolCallId: z.string(),
  toolName: z.string(),
  title: z.string().optional(),
});

export const toolInputDeltaEventSchema = z.object({
  type: z.literal('tool-input-delta'),
  toolCallId: z.string(),
  inputTextDelta: z.string(),
});

export const toolInputEndEventSchema = z.object({
  type: z.literal('tool-input-end'),
  toolCallId: z.string(),
});

export const toolInputAvailableEventSchema = z.object({
  type: z.literal('tool-input-available'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

export const toolOutputAvailableEventSchema = z.object({
  type: z.literal('tool-output-available'),
  toolCallId: z.string(),
  output: z.unknown(),
});

export const toolOutputErrorEventSchema = z.object({
  type: z.literal('tool-output-error'),
  toolCallId: z.string(),
  error: z.string(),
});

// ================================ Source =====================================

export const sourceUrlEventSchema = z.object({
  type: z.literal('source'),
  sourceType: z.literal('url'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
});

export const sourceDocumentEventSchema = z.object({
  type: z.literal('source'),
  sourceType: z.literal('document'),
  id: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
});

export const sourceEventSchema = z.discriminatedUnion('sourceType', [
  sourceUrlEventSchema,
  sourceDocumentEventSchema,
]);

// =============================================================================
// OCTAVUS EVENTS (protocol-specific)
// =============================================================================

// --------------------------------- Block -------------------------------------

export const blockStartEventSchema = z.object({
  type: z.literal('block-start'),
  blockId: z.string(),
  blockName: z.string(),
  blockType: z.string(),
  display: displayModeSchema,
  description: z.string().optional(),
  outputToChat: z.boolean().optional(),
  thread: z.string().optional(),
});

export const blockEndEventSchema = z.object({
  type: z.literal('block-end'),
  blockId: z.string(),
  summary: z.string().optional(),
});

export const resourceUpdateEventSchema = z.object({
  type: z.literal('resource-update'),
  name: z.string(),
  value: z.unknown(),
});

export const pendingToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  source: z.enum(['llm', 'block']).optional(),
  outputVariable: z.string().optional(),
  blockIndex: z.number().optional(),
});

export const toolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  outputVariable: z.string().optional(),
  blockIndex: z.number().optional(),
});

export const toolRequestEventSchema = z.object({
  type: z.literal('tool-request'),
  toolCalls: z.array(pendingToolCallSchema),
});

export const clientToolRequestEventSchema = z.object({
  type: z.literal('client-tool-request'),
  executionId: z.string(),
  toolCalls: z.array(pendingToolCallSchema),
  serverToolResults: z.array(toolResultSchema).optional(),
});

// --------------------------------- File --------------------------------------

/**
 * Schema for file references used in trigger input and user messages.
 */
export const fileReferenceSchema = z.object({
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
});

export const fileAvailableEventSchema = z.object({
  type: z.literal('file-available'),
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  toolCallId: z.string().optional(),
});

// --------------------------------- Worker ------------------------------------

export const workerStartEventSchema = z.object({
  type: z.literal('worker-start'),
  workerId: z.string(),
  workerSlug: z.string(),
  workerSessionId: z.string().optional(),
});

export const workerResultEventSchema = z.object({
  type: z.literal('worker-result'),
  workerId: z.string(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

// =============================================================================
// Union of all stream events
// =============================================================================

// Note: We use z.union here because source events share type: 'source' but
// differ by sourceType. z.discriminatedUnion requires unique discriminator values.
export const streamEventSchema = z.union([
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
  // Octavus-specific events
  blockStartEventSchema,
  blockEndEventSchema,
  resourceUpdateEventSchema,
  toolRequestEventSchema,
  clientToolRequestEventSchema,
  fileAvailableEventSchema,
  // Worker events
  workerStartEventSchema,
  workerResultEventSchema,
]);

// =============================================================================
// Internal Message Types (used by platform/runtime)
// =============================================================================

export const messagePartTypeSchema = z.enum([
  'text',
  'reasoning',
  'tool-call',
  'source',
  'file',
  'object',
]);

export const sourceUrlInfoSchema = z.object({
  sourceType: z.literal('url'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
});

export const sourceDocumentInfoSchema = z.object({
  sourceType: z.literal('document'),
  id: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
});

export const sourceInfoSchema = z.discriminatedUnion('sourceType', [
  sourceUrlInfoSchema,
  sourceDocumentInfoSchema,
]);

export const fileInfoSchema = z.object({
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  toolCallId: z.string().optional(),
});

export const objectInfoSchema = z.object({
  id: z.string(),
  typeName: z.string(),
  value: z.unknown(),
});

export const messagePartSchema = z.object({
  type: messagePartTypeSchema,
  visible: z.boolean(),
  content: z.string().optional(),
  toolCall: toolCallInfoSchema.optional(),
  source: sourceInfoSchema.optional(),
  file: fileInfoSchema.optional(),
  object: objectInfoSchema.optional(),
  thread: z.string().optional(),
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  parts: z.array(messagePartSchema),
  createdAt: z.string(),
  visible: z.boolean().optional(),
  content: z.string(),
  toolCalls: z.array(toolCallInfoSchema).optional(),
  reasoning: z.string().optional(),
  reasoningSignature: z.string().optional(),
});

// =============================================================================
// UI Message Types (used by SDKs and consumer apps)
// =============================================================================

export const uiMessageStatusSchema = z.enum(['streaming', 'done']);
export const uiPartStatusSchema = z.enum(['streaming', 'done']);
export const uiToolCallStatusSchema = z.enum(['pending', 'running', 'done', 'error']);

export const uiTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  status: uiPartStatusSchema,
  thread: z.string().optional(),
});

export const uiReasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  status: uiPartStatusSchema,
  thread: z.string().optional(),
});

export const uiToolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  displayName: z.string().optional(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  status: uiToolCallStatusSchema,
  thread: z.string().optional(),
});

export const uiOperationStatusSchema = z.enum(['running', 'done']);

export const uiOperationPartSchema = z.object({
  type: z.literal('operation'),
  operationId: z.string(),
  name: z.string(),
  operationType: z.string(),
  status: uiOperationStatusSchema,
  thread: z.string().optional(),
});

export const uiSourceUrlPartSchema = z.object({
  type: z.literal('source'),
  sourceType: z.literal('url'),
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  thread: z.string().optional(),
});

export const uiSourceDocumentPartSchema = z.object({
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

export const uiFilePartSchema = z.object({
  type: z.literal('file'),
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  toolCallId: z.string().optional(),
  thread: z.string().optional(),
});

export const uiObjectStatusSchema = z.enum(['streaming', 'done', 'error']);

export const uiObjectPartSchema = z.object({
  type: z.literal('object'),
  id: z.string(),
  typeName: z.string(),
  partial: z.unknown().optional(),
  object: z.unknown().optional(),
  status: uiObjectStatusSchema,
  error: z.string().optional(),
  thread: z.string().optional(),
});

// Note: We use z.union here because source parts share type: 'source' but
// differ by sourceType. z.discriminatedUnion requires unique discriminator values.
export const uiMessagePartSchema = z.union([
  uiTextPartSchema,
  uiReasoningPartSchema,
  uiToolCallPartSchema,
  uiOperationPartSchema,
  uiSourcePartSchema,
  uiFilePartSchema,
  uiObjectPartSchema,
]);

export const uiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(uiMessagePartSchema),
  status: uiMessageStatusSchema,
  createdAt: z.coerce.date(),
});

export function safeParseStreamEvent(data: unknown) {
  return streamEventSchema.safeParse(data);
}

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
export function isFileReference(value: unknown): value is z.infer<typeof fileReferenceSchema> {
  return fileReferenceSchema.safeParse(value).success;
}

/**
 * Type guard to check if a value is an array of FileReference objects.
 */
export function isFileReferenceArray(
  value: unknown,
): value is z.infer<typeof fileReferenceSchema>[] {
  return z.array(fileReferenceSchema).safeParse(value).success;
}
