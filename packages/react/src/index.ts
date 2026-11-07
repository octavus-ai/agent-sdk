export {
  useOctavusChat,
  type UseOctavusChatReturn,
  type OctavusChatOptions,
  type ChatStatus,
  type UserMessageInput,
  type ClientToolContext,
  type ClientToolHandler,
  type InteractiveTool,
} from './hooks/use-octavus-chat';

export { useAutoScroll, type UseAutoScrollOptions } from './hooks/use-auto-scroll';

export type {
  // Transports
  Transport,
  TriggerOptions,
  SocketTransport,
  ConnectionState,
  ConnectionStateListener,
  ChatControlSignal,
  ChatStreamItem,
  HttpTransportOptions,
  HttpRequestOptions,
  HttpRequest,
  TriggerRequest,
  ContinueRequest,
  SocketLike,
  SocketTransportOptions,
  PollingTransportOptions,
  PollResult,
  // Files
  UploadFilesOptions,
  UploadUrlsResponse,
  // Text smoothing
  TextSmoothingOption,
  TextSmoothingConfig,
  TextSmoothingGranularity,
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
} from '@octavus/client-sdk';
export {
  // Chat
  OctavusChat,
  // Files
  uploadFiles,
  // Stream
  parseSSEStream,
  // Transports
  createHttpTransport,
  createSocketTransport,
  isSocketTransport,
  createPollingTransport,
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
} from '@octavus/client-sdk';
