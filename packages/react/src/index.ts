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

export type * from '@octavus/client-sdk';
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
  // Error classes
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  OctavusError,
  // Error type guards
  isRateLimitError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
  // Error event helpers
  createErrorEvent,
  errorToStreamEvent,
  createInternalErrorEvent,
  createApiErrorEvent,
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
  // Safe parse helpers
  safeParseStreamEvent,
  safeParseUIMessage,
  safeParseUIMessages,
  // Skills
  OCTAVUS_SKILL_TOOLS,
  isOctavusSkillTool,
  getSkillSlugFromToolCall,
} from '@octavus/client-sdk';
