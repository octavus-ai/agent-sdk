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

export { generateId, isAbortError } from './utils';
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
} from './stream/schemas';

export type {
  // Common
  DisplayMode,
  ToolHandler,
  ToolHandlers,
  ResourceUpdateHandler,
  FileReference,
  MessageRole,
  ToolCallStatus,
  ToolCallInfo,
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
  type OctavusInternalToolName,
  type OctavusSkillToolName,
} from './internal-tools';

// Skill utilities
export { getSkillSlugFromToolCall } from './skills';
