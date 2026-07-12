export { OctavusClient, type OctavusClientConfig } from '@/client.js';
export { AgentsApi } from '@/agents.js';
export {
  AgentSessionsApi,
  type SessionState,
  type UISessionState,
  type ExpiredSessionState,
  type RestoreSessionResult,
  type ClearSessionResult,
  type SessionStatus,
  type SessionAttachOptions,
  type StartSessionOptions,
  type GetLogsOptions,
  type ExecutionLogsResult,
} from '@/agent-sessions.js';
export {
  FilesApi,
  type FileUploadRequest,
  type FileUploadInfo,
  type UploadUrlsResponse,
} from '@/files.js';
export {
  AgentSession,
  toSSEStream,
  type SessionConfig,
  type DeferredStartConfig,
  type TriggerOptions,
  type SessionRequest,
  type TriggerRequest,
  type ContinueRequest,
  type StopMessage,
  type SocketMessage,
  type SocketMessageHandlers,
} from '@/session.js';
export {
  WorkersApi,
  type WorkerStartRequest,
  type WorkerContinueRequest,
  type WorkerRequest,
  type WorkerExecuteOptions,
  type WorkerGenerateResult,
} from '@/workers.js';
export {
  WorkforceApi,
  isTerminalThreadStatus,
  type WorkforceThreadStatus,
  type WorkforceDispatchResult,
  type WorkforceThread,
  type WorkforceDispatchOptions,
  type WorkforceWaitOptions,
  type WorkforceRunOptions,
} from '@/workforce.js';
export { WorkerError, type WorkerErrorDetails } from '@/worker-error.js';
// eslint-disable-next-line @typescript-eslint/no-deprecated -- re-exporting the deprecated Resource so existing consumers keep compiling
export { Resource } from '@/resource.js';
export { ApiError } from '@/api-error.js';
export { createInlineMcpServer, defineInlineMcpTool } from '@/inline-mcp.js';
export { normalizeToolResultMedia } from '@/normalize-media.js';
export { normalizeToolResultOutputFiles } from '@/normalize-output-files.js';
export {
  enforceToolResultsSize,
  MAX_CONTINUATION_BODY_BYTES,
  CONTINUATION_BODY_RESERVE_BYTES,
  type ToolResultTruncation,
  type EnforceToolResultsSizeResult,
} from '@/tool-result-size.js';

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
  isDeviceProvider,
  isDynamicMcpProvider,
  // Safe parse helpers
  safeParseStreamEvent,
  safeParseUIMessage,
  safeParseUIMessages,
  // Skills
  OCTAVUS_SKILL_TOOLS,
  isOctavusSkillTool,
  getSkillSlugFromToolCall,
  // MCP management
  OCTAVUS_MCP_TOOLS,
  isOctavusMcpTool,
} from '@octavus/core';
