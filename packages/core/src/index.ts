export { AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError } from './errors';

// Structured error types for streaming
export type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  OctavusErrorOptions,
} from './errors/types';

export {
  OctavusError,
  isRateLimitError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
} from './errors/octavus-error';

// Error event helpers
export type { CreateErrorEventOptions } from './errors/helpers';
export {
  createErrorEvent,
  errorToStreamEvent,
  createInternalErrorEvent,
  createApiErrorEvent,
} from './errors/helpers';

export { generateId, isAbortError, normalizeToolInputSchema } from './utils';
export { MAIN_THREAD, resolveThread, isMainThread, threadForPart, isOtherThread } from './thread';

export { isFileReference, isFileReferenceArray } from './stream/schemas';

export {
  chatMessageSchema,
  toolResultSchema,
  fileReferenceSchema,
  uiMessageSchema,
  uiMessagePartSchema,
  uiWorkerPartSchema,
  uiWorkerStatusSchema,
  todoItemStatusSchema,
  todoItemSchema,
  todoInfoSchema,
  todoUpdateEventSchema,
  uiTodoItemSchema,
  uiTodoPartSchema,
} from './stream/schemas';

export { isDeviceProvider } from './stream/types';

export type {
  // Common
  DisplayMode,
  ToolHandler,
  ToolHandlers,
  ToolSchema,
  ToolProvider,
  DynamicTool,
  EntryHealth,
  ComputerHealth,
  EnsureReadyResult,
  DeviceProvider,
  ResourceUpdateHandler,
  FileReference,
  MessageRole,
  ToolCallStatus,
  ToolCallInfo,
  ProviderMetadata,
  FinishReason,
  // Lifecycle Events
  StartEvent,
  FinishEvent,
  ErrorEvent,
  // Text Events
  TextStartEvent,
  TextDeltaEvent,
  TextEndEvent,
  // Reasoning Events
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  // Tool Events
  ToolInputStartEvent,
  ToolInputDeltaEvent,
  ToolInputEndEvent,
  ToolInputAvailableEvent,
  ToolOutputAvailableEvent,
  ToolOutputErrorEvent,
  // Source Events (aligned with Vercel AI SDK)
  SourceUrlEvent,
  SourceDocumentEvent,
  SourceEvent,
  // Octavus-Specific
  BlockStartEvent,
  BlockEndEvent,
  ResourceUpdateEvent,
  PendingToolCall,
  ToolRequestEvent,
  ClientToolRequestEvent,
  ToolResult,
  // File Events (skill execution)
  GeneratedFile,
  FileAvailableEvent,
  // Todo Events
  TodoItemStatus,
  TodoItem,
  TodoUpdateEvent,
  // Worker Events
  WorkerStartEvent,
  WorkerResultEvent,
  // Union
  StreamEvent,
  // Internal Message Types
  MessagePartType,
  SourceUrlInfo,
  SourceDocumentInfo,
  SourceInfo,
  FileInfo,
  ObjectInfo,
  OperationInfo,
  TodoInfo,
  WorkerPartInfo,
  MessagePart,
  ToolResultEntry,
  ChatMessage,
  // UI Message Types (for client SDK and consumer apps)
  UIMessageStatus,
  UIPartStatus,
  UITextPart,
  UIReasoningPart,
  UIToolCallStatus,
  UIToolCallPart,
  UIOperationStatus,
  UIOperationPart,
  UISourceUrlPart,
  UISourceDocumentPart,
  UISourcePart,
  UIFilePart,
  UIObjectStatus,
  UIObjectPart,
  UITodoItem,
  UITodoPart,
  UIWorkerStatus,
  UIWorkerPart,
  UIMessagePart,
  UIMessage,
} from './stream/types';

export { safeParseStreamEvent, safeParseUIMessage, safeParseUIMessages } from './stream/schemas';

// Internal tools
export {
  OCTAVUS_INTERNAL_PREFIX,
  OCTAVUS_INTERNAL_TOOLS,
  isOctavusInternalTool,
  OCTAVUS_SKILL_TOOLS,
  isOctavusSkillTool,
  OCTAVUS_MCP_TOOLS,
  isOctavusMcpTool,
  OCTAVUS_REFERENCE_TOOLS,
  isOctavusReferenceTool,
  type OctavusInternalToolName,
  type OctavusSkillToolName,
  type OctavusMcpToolName,
  type OctavusReferenceToolName,
} from './internal-tools';

// Skill utilities
export { getSkillSlugFromToolCall } from './skills';
