export { OctavusClient, type OctavusClientConfig } from '@/client.js';
export { AgentsApi } from '@/agents.js';
export {
  AgentSessionsApi,
  type SessionState,
  type UISessionState,
  type ExpiredSessionState,
  type RestoreSessionResult,
  type SessionStatus,
  type SessionAttachOptions,
} from '@/agent-sessions.js';
export {
  FilesApi,
  type FileUploadRequest,
  type FileUploadInfo,
  type UploadUrlsResponse,
} from '@/files.js';
export { AgentSession, toSSEStream, type SessionConfig, type TriggerOptions } from '@/session.js';
export { Resource } from '@/resource.js';
export { ApiError } from '@/api-error.js';

// Agent types (read-only - use @octavus/cli for agent management)
export type {
  AgentFormat,
  AgentSettings,
  AgentPrompt,
  Agent,
  AgentDefinition,
} from '@/agent-types.js';

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
