export {
  OctavusChat,
  type OctavusChatOptions,
  type ChatStatus,
  type UserMessageInput,
} from './chat';

export { uploadFiles, type UploadFilesOptions, type UploadUrlsResponse } from './files';

export { parseSSEStream } from './stream/reader';

// Transport exports
export {
  createHttpTransport,
  createSocketTransport,
  isSocketTransport,
  type Transport,
  type SocketTransport,
  type ConnectionState,
  type ConnectionStateListener,
  type HttpTransportOptions,
  type TriggerRequestOptions,
  type SocketLike,
  type SocketTransportOptions,
} from './transports';

export type * from '@octavus/core';
export {
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
} from '@octavus/core';
