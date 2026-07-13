export type {
  ErrorType,
  ErrorSource,
  ProviderErrorInfo,
  ToolErrorInfo,
  OctavusErrorOptions,
} from './types';

export {
  OctavusError,
  isRateLimitError,
  isQuotaExceededError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
} from './octavus-error';

export type { CreateErrorEventOptions } from './helpers';
export {
  createErrorEvent,
  errorToStreamEvent,
  createInternalErrorEvent,
  createApiErrorEvent,
} from './helpers';
