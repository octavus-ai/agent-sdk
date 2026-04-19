---
title: Error Handling
description: Handling errors in streaming responses with structured error types.
---

# Error Handling

Octavus provides structured error handling across all transports. Errors are categorized by type and source, enabling you to build appropriate UI responses and monitoring.

## Error Types

The `onError` callback receives an `OctavusError` with structured information:

```typescript
import { useOctavusChat, type OctavusError } from '@octavus/react';

const { error, status } = useOctavusChat({
  transport,
  onError: (err: OctavusError) => {
    console.error('Chat error:', {
      type: err.errorType, // Error classification
      message: err.message, // Human-readable message
      source: err.source, // Where the error originated
      retryable: err.retryable, // Can be retried
      retryAfter: err.retryAfter, // Seconds to wait (rate limits)
      code: err.code, // Machine-readable code
      provider: err.provider, // Provider details (if applicable)
    });
  },
});
```

## Error Classification

### Error Types

| Type                   | Description           | Typical Response    |
| ---------------------- | --------------------- | ------------------- |
| `rate_limit_error`     | Too many requests     | Show retry timer    |
| `quota_exceeded_error` | Usage quota exceeded  | Show upgrade prompt |
| `authentication_error` | Invalid API key       | Check configuration |
| `permission_error`     | No access to resource | Check permissions   |
| `validation_error`     | Invalid request       | Fix request data    |
| `provider_error`       | LLM provider issue    | Retry or show error |
| `provider_overloaded`  | Provider at capacity  | Retry with backoff  |
| `provider_timeout`     | Provider timed out    | Retry               |
| `tool_error`           | Tool execution failed | Show tool error     |
| `internal_error`       | Platform error        | Show generic error  |

### Error Sources

| Source     | Description                                  |
| ---------- | -------------------------------------------- |
| `platform` | Octavus platform error                       |
| `provider` | LLM provider error (OpenAI, Anthropic, etc.) |
| `tool`     | Tool execution error                         |
| `client`   | Client-side error (network, parsing)         |

## Type Guards

Use type guards to handle specific error types:

```typescript
import {
  useOctavusChat,
  isRateLimitError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
} from '@octavus/react';

const { error } = useOctavusChat({
  transport,
  onError: (err) => {
    if (isRateLimitError(err)) {
      // Show countdown timer
      showRetryTimer(err.retryAfter ?? 60);
      return;
    }

    if (isAuthenticationError(err)) {
      // Configuration issue - shouldn't happen in production
      reportConfigError(err);
      return;
    }

    if (isProviderError(err)) {
      // LLM service issue
      showProviderError(err.provider?.name ?? 'AI service');
      return;
    }

    if (isToolError(err)) {
      // Tool failed - already shown inline
      return;
    }

    if (isRetryableError(err)) {
      // Generic retryable error
      showRetryButton();
      return;
    }

    // Non-retryable error
    showGenericError(err.message);
  },
});
```

## Provider Error Details

When errors come from LLM providers, additional details are available:

```typescript
if (isProviderError(error) && error.provider) {
  console.log({
    name: error.provider.name, // 'anthropic', 'openai', 'google'
    model: error.provider.model, // Model that caused the error
    statusCode: error.provider.statusCode, // HTTP status code
    errorType: error.provider.errorType, // Provider's error type
    requestId: error.provider.requestId, // For support tickets
  });
}
```

## Retrying After Errors

Use `retry()` to re-execute the last trigger from the same starting point. Messages are rolled back, the user message is re-added (if any), and the agent re-executes. Files are reused without re-uploading.

```tsx
const { error, canRetry, retry } = useOctavusChat({ transport });

// Retry after any error
if (canRetry) {
  await retry();
}
```

`retry()` also works after stopping (cancellation) or when the result is unsatisfactory - not just errors.

## Building Error UI

```tsx
import {
  useOctavusChat,
  isRateLimitError,
  isAuthenticationError,
  isProviderError,
} from '@octavus/react';

function Chat() {
  const { error, status, retry, canRetry } = useOctavusChat({ transport });

  return (
    <div>
      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="font-medium text-red-800">{getErrorTitle(error)}</div>
          <p className="text-red-600 text-sm mt-1">{error.message}</p>
          {isRateLimitError(error) && error.retryAfter && (
            <p className="text-red-500 text-sm mt-2">
              Please try again in {error.retryAfter} seconds
            </p>
          )}
          {canRetry && (
            <button className="mt-3 text-red-700 underline" onClick={() => void retry()}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getErrorTitle(error: OctavusError): string {
  if (isRateLimitError(error)) return 'Service is busy';
  if (isAuthenticationError(error)) return 'Configuration error';
  if (isProviderError(error)) return 'AI service unavailable';
  return 'Something went wrong';
}
```

## Monitoring & Logging

Log errors for monitoring and debugging:

```typescript
useOctavusChat({
  transport,
  onError: (err) => {
    // Send to your monitoring service
    analytics.track('octavus_error', {
      errorType: err.errorType,
      source: err.source,
      retryable: err.retryable,
      code: err.code,
      provider: err.provider?.name,
    });

    // Log for debugging
    console.error('[Octavus]', {
      type: err.errorType,
      message: err.message,
      source: err.source,
      provider: err.provider,
    });
  },
});
```

## Error State

The hook exposes error state directly:

```typescript
const { error, status, retry, canRetry } = useOctavusChat({ transport });

// status is 'error' when an error occurred
// error contains the OctavusError object

// Option 1: Retry the same trigger (rolls back messages, re-executes)
if (canRetry) {
  await retry();
}

// Option 2: Send a new message (clears the error)
await send('user-message', { USER_MESSAGE: 'Try again' });
```

## Rate Limit Handling

Rate limits include retry information:

```typescript
if (isRateLimitError(error)) {
  const waitTime = error.retryAfter ?? 60; // Default to 60 seconds

  // Show countdown
  setCountdown(waitTime);
  const timer = setInterval(() => {
    setCountdown((c) => {
      if (c <= 1) {
        clearInterval(timer);
        return 0;
      }
      return c - 1;
    });
  }, 1000);
}
```

## Error Event Structure

For custom transports or direct event handling, errors follow this structure:

```typescript
interface ErrorEvent {
  type: 'error';
  errorType: ErrorType;
  message: string;
  source: ErrorSource;
  retryable: boolean;
  retryAfter?: number;
  code?: string;
  provider?: {
    name: string;
    model?: string;
    statusCode?: number;
    errorType?: string;
    requestId?: string;
  };
  tool?: {
    name: string;
    callId?: string;
  };
}
```

## Tool Errors

Tool errors are handled differently - they appear inline on the tool call:

```tsx
function ToolCallPart({ part }: { part: UIToolCallPart }) {
  return (
    <div>
      <span>{part.toolName}</span>

      {part.status === 'error' && <div className="text-red-500 text-sm mt-1">{part.error}</div>}
    </div>
  );
}
```

Tool errors don't trigger `onError` - they're captured on the tool call part itself.
