export {
  OctavusChat,
  type OctavusChatOptions,
  type ChatStatus,
  type ExecutionStart,
  type UserMessageInput,
  type ClientToolContext,
  type ClientToolHandler,
  type InteractiveTool,
} from './chat';

export type {
  TextSmoothingOption,
  TextSmoothingConfig,
  TextSmoothingGranularity,
} from './text-pacer';

export { uploadFiles, type UploadFilesOptions, type UploadUrlsResponse } from './files';

export { parseSSEStream } from './stream/reader';

// Transport exports
export {
  createHttpTransport,
  createSocketTransport,
  isSocketTransport,
  createPollingTransport,
  type Transport,
  type TriggerOptions,
  type SocketTransport,
  type ConnectionState,
  type ConnectionStateListener,
  type ChatControlSignal,
  type ChatStreamItem,
  type HttpTransportOptions,
  type HttpRequestOptions,
  type HttpRequest,
  type TriggerRequest,
  type ContinueRequest,
  type SocketLike,
  type SocketTransportOptions,
  type PollingTransportOptions,
  type PollResult,
} from './transports';

// The wire contract, re-exported so consumers rarely need `@octavus/core` directly
export type {
  // Shared values
  DisplayMode,
  FileReference,
  FinishReason,
  // Lifecycle events
  StartEvent,
  FinishEvent,
  ErrorEvent,
  // Text events
  TextStartEvent,
  TextDeltaEvent,
  TextEndEvent,
  // Reasoning events
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  // Tool events
  ToolInputStartEvent,
  ToolInputDeltaEvent,
  ToolInputEndEvent,
  ToolInputAvailableEvent,
  ToolOutputAvailableEvent,
  ToolOutputErrorEvent,
  // Source events
  SourceUrlEvent,
  SourceDocumentEvent,
  SourceEvent,
  // Octavus-specific events
  BlockStartEvent,
  BlockEndEvent,
  StepStartEvent,
  StepDiscardEvent,
  PersistedEvent,
  PendingToolCall,
  ToolRequestEvent,
  ClientToolRequestEvent,
  ToolResult,
  FileAvailableEvent,
  // Todo events
  TodoItemStatus,
  TodoItem,
  TodoUpdateEvent,
  // Worker events
  WorkerStartEvent,
  WorkerResultEvent,
  WorkerInputStartEvent,
  WorkerInputDeltaEvent,
  WorkerInputReadyEvent,
  // Usage events
  UsageEvent,
  WorkerExecutionCost,
  WorkerExecutionTokens,
  // Union
  StreamEvent,
  UnknownStreamEvent,
  StreamEventParseResult,
  WireParseResult,
  WireParseError,
  WireParseIssue,
  // UI messages
  UIMessage,
  UIMessageStatus,
  UIMessagePart,
  UIMessageSender,
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
  UIStepStartPart,
  UIUnknownPart,
  // Errors
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  BackupFailureInfo,
  OctavusErrorOptions,
  // Labels and display
  PartIdentity,
  PartLabelResolver,
  LabeledPart,
  DisplayReveal,
  // Tolerance
  UnknownWireValue,
  UnknownWireValueReporter,
} from '@octavus/core';
export {
  // Errors
  OctavusError,
  isRateLimitError,
  isQuotaExceededError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
  isNotFoundError,
  isTransientTransportError,
  // Utilities
  generateId,
  isAbortError,
  // Thread helpers
  MAIN_THREAD,
  resolveThread,
  isMainThread,
  threadForPart,
  isOtherThread,
  // Type guards
  isFileReference,
  isFileReferenceArray,
  // Parse helpers
  safeParseStreamEvent,
  safeParseUIMessage,
  safeParseUIMessages,
  setUnknownWireValueReporter,
  // Labels and display
  getPartLabel,
  getPartIdentity,
  formatIdentityLabel,
  displayReveals,
  // Skills
  OCTAVUS_SKILL_TOOLS,
  isOctavusSkillTool,
  getSkillSlugFromToolCall,
} from '@octavus/core';
