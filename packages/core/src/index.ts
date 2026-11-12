// Errors
export type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  BackupFailureInfo,
  OctavusErrorOptions,
} from './errors/types';
export type { ApiResponseErrorOptions } from './errors/octavus-error';
export {
  OctavusError,
  isRateLimitError,
  isQuotaExceededError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
  isNotFoundError,
} from './errors/octavus-error';
export {
  isTransientTransportError,
  EXECUTION_NOT_RESUMABLE_CODE,
  UNKNOWN_TOOL_CALL_CODE,
  SESSION_EXPIRED_CODE,
  INVALID_FILE_REFERENCE_CODE,
} from './errors/transport';

export { generateId, isAbortError, normalizeToolInputSchema } from './utils';
export { MAIN_THREAD, resolveThread, isMainThread, threadForPart, isOtherThread } from './thread';

// Wire schemas (the single definition of every shape) and parse helpers
export {
  // Tolerance
  setUnknownWireValueReporter,
  type UnknownWireValue,
  type UnknownWireValueReporter,
  type Wire,
  // Shared values
  DISPLAY_MODES,
  displayModeSchema,
  finishReasonSchema,
  errorTypeSchema,
  errorSourceSchema,
  todoItemStatusSchema,
  todoItemSchema,
  fileReferenceSchema,
  uiMessageSenderSchema,
  // Events
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
  sourceEventSchema,
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
  usageEventSchema,
  streamEventSchema,
  unknownStreamEventSchema,
  safeParseStreamEvent,
  // UI messages
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
  uiSourcePartSchema,
  uiFilePartSchema,
  uiObjectPartSchema,
  uiTodoItemSchema,
  uiTodoPartSchema,
  uiStepStartPartSchema,
  uiUnknownPartSchema,
  uiWorkerPartSchema,
  uiMessagePartSchema,
  uiMessageSchema,
  safeParseUIMessage,
  safeParseUIMessages,
  // Guards
  isFileReference,
  isFileReferenceArray,
} from './stream/schemas';

export { isDeviceProvider, isDynamicMcpProvider } from './stream/types';

export type {
  // Common
  DisplayMode,
  ToolHandler,
  ToolHandlers,
  ToolSchema,
  ToolProvider,
  InlineMcpServer,
  DynamicTool,
  EntryHealth,
  ComputerHealth,
  EnsureReadyResult,
  DeviceProvider,
  DynamicStdioEntry,
  DynamicMcpProvider,
  FileReference,
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
  StepStartEvent,
  StepDiscardEvent,
  PersistedEvent,
  PendingToolCall,
  ToolRequestEvent,
  ClientToolRequestEvent,
  ToolResult,
  // File Events (skill execution)
  FileAvailableEvent,
  // Todo Events
  TodoItemStatus,
  TodoItem,
  TodoUpdateEvent,
  // Worker Events
  WorkerStartEvent,
  WorkerResultEvent,
  WorkerInputStartEvent,
  WorkerInputDeltaEvent,
  WorkerInputReadyEvent,
  // Usage Events
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
  UIStepStartPart,
  UIUnknownPart,
  UIMessagePart,
  UIMessage,
  UIMessageSender,
} from './stream/types';

// Display
export { displayReveals, type DisplayReveal } from './stream/display';

// Labels
export {
  getPartLabel,
  getPartIdentity,
  formatIdentityLabel,
  type PartIdentity,
  type PartLabelResolver,
  type LabeledPart,
} from './stream/labels';

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

// Execution log types
export type {
  LogEntryFile,
  LoggedToolCall,
  ModelRequestTrace,
  StepStatsTrace,
  StepThinking,
  StepImages,
  StepReportedCost,
  StepRouterDecision,
  ExecutionLogError,
  ExecutionLogEntryType,
  ExecutionLogEntryBase,
  TriggerLogEntry,
  MessageLogEntry,
  ToolCallLogEntry,
  ToolResultLogEntry,
  ScriptToolCallLogEntry,
  LlmToolRequestLogEntry,
  LlmResponseLogEntry,
  ReasoningLogEntry,
  ThreadCreatedLogEntry,
  BlockOperationLogEntry,
  ModelRequestLogEntry,
  StepStatsLogEntry,
  WorkerExecutionLogEntry,
  WorkerOutputLogEntry,
  CompactionLogEntry,
  ToolOutputBoundedLogEntry,
  ImageAdaptedLogEntry,
  AbortLogEntry,
  ErrorLogEntry,
  ExecutionLogEntry,
  TrimmedValue,
} from './execution-log';
export { isTrimmedValue } from './execution-log';

// Inline media handling for MCP tool results
export {
  isInlineMediaPart,
  inlineMediaType,
  findInlineMediaParts,
  extensionForMediaType,
  base64ByteLength,
  stripInlineMediaData,
  sniffImageMediaType,
  sniffImageDimensions,
  NOT_A_VALID_IMAGE_NOTE,
} from './media-tool-result';
export type {
  InlineMediaKind,
  InlineMediaPart,
  InlineMediaLocation,
  ImageDimensions,
} from './media-tool-result';
