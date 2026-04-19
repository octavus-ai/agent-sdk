# @octavus/core

Shared types and utilities for Octavus SDK communication.

## Installation

```bash
npm install @octavus/core
```

## Overview

This package provides the foundational types and utilities shared between `@octavus/server-sdk` and `@octavus/client-sdk`. Most users won't need to install this package directly - it's automatically included as a dependency of the SDK packages.

## What's Included

### Stream Event Types

Types for all streaming events in Octavus agent communication:

- **Lifecycle events**: `StartEvent`, `FinishEvent`, `ErrorEvent`
- **Text events**: `TextStartEvent`, `TextDeltaEvent`, `TextEndEvent`
- **Reasoning events**: `ReasoningStartEvent`, `ReasoningDeltaEvent`, `ReasoningEndEvent`
- **Tool events**: `ToolInputStartEvent`, `ToolInputAvailableEvent`, `ToolOutputAvailableEvent`, etc.
- **Source events**: `SourceUrlEvent`, `SourceDocumentEvent`
- **Octavus events**: `BlockStartEvent`, `BlockEndEvent`, `ResourceUpdateEvent`, `ToolRequestEvent`, `FileAvailableEvent`

### UI Message Types

Types for rendering agent messages in your application:

```typescript
import type { UIMessage, UIMessagePart, UITextPart, UIToolCallPart } from '@octavus/core';
```

### Error Handling

Structured error types with classification for proper UI handling:

```typescript
import {
  OctavusError,
  isRateLimitError,
  isAuthenticationError,
  isProviderError,
  isToolError,
  isRetryableError,
  isValidationError,
} from '@octavus/core';

// Handle errors based on type
if (isRateLimitError(error)) {
  showRetryUI(error.retryAfter);
} else if (isAuthenticationError(error)) {
  redirectToLogin();
} else if (isValidationError(error)) {
  showValidationError(error.message);
}
```

### Utilities

```typescript
import { generateId, isAbortError, isOtherThread } from '@octavus/core';

// Generate unique IDs
const id = generateId(); // "1702345678901-abc123def"

// Check if error is from abort signal
if (isAbortError(error)) {
  // User cancelled the request
}

// Check if message part belongs to a non-main thread
if (isOtherThread(part)) {
  // Render differently for secondary threads
}
```

### Zod Schemas

Validation schemas for runtime type checking:

```typescript
import { safeParseStreamEvent, safeParseUIMessage } from '@octavus/core';

const result = safeParseStreamEvent(data);
if (result.success) {
  handleEvent(result.data);
}
```

## Related Packages

- [`@octavus/server-sdk`](https://www.npmjs.com/package/@octavus/server-sdk) - Server-side SDK
- [`@octavus/client-sdk`](https://www.npmjs.com/package/@octavus/client-sdk) - Client-side SDK
- [`@octavus/react`](https://www.npmjs.com/package/@octavus/react) - React hooks and bindings

## License

MIT
