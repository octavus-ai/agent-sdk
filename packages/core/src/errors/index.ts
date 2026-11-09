export type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  BackupFailureInfo,
  OctavusErrorOptions,
} from './types';
export type { ApiResponseErrorOptions } from './octavus-error';

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
} from './octavus-error';

export {
  isTransientTransportError,
  EXECUTION_NOT_RESUMABLE_CODE,
  UNKNOWN_TOOL_CALL_CODE,
  SESSION_EXPIRED_CODE,
} from './transport';
