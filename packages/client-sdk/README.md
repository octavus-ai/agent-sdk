# @octavus/client-sdk

Framework-agnostic client SDK for Octavus agents.

## Installation

```bash
npm install @octavus/client-sdk
```

## Overview

This package provides a framework-agnostic client for streaming Octavus agent responses. It handles message state management, streaming events, and transport abstraction.

For React applications, use [`@octavus/react`](https://www.npmjs.com/package/@octavus/react) instead—it provides React hooks that wrap this SDK.

## Quick Start

```typescript
import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';

// Create transport
const transport = createHttpTransport({
  request: (req, options) =>
    fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...req }),
      signal: options?.signal,
    }),
});

// Create chat client
const chat = new OctavusChat({ transport });

// Subscribe to state changes
const unsubscribe = chat.subscribe(() => {
  console.log('Messages:', chat.messages);
  console.log('Status:', chat.status);
});

// Send a message
await chat.send('user-message', { USER_MESSAGE: 'Hello!' }, { userMessage: { content: 'Hello!' } });

// Cleanup
unsubscribe();
```

## Transports

### HTTP Transport (SSE)

Best for Next.js, Express, and HTTP-based applications:

```typescript
import { createHttpTransport } from '@octavus/client-sdk';

const transport = createHttpTransport({
  request: (req, options) =>
    fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...req }),
      signal: options?.signal,
    }),
});
```

### Socket Transport (WebSocket/SockJS)

Best for real-time applications with persistent connections:

```typescript
import { createSocketTransport } from '@octavus/client-sdk';

const transport = createSocketTransport({
  connect: () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://api.example.com/stream?sessionId=${sessionId}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('Connection failed'));
    }),
});

// Optional: eagerly connect and monitor state
transport.onConnectionStateChange((state, error) => {
  console.log('Connection state:', state);
});
await transport.connect();
```

## Chat Client

### Creating a Chat Instance

```typescript
const chat = new OctavusChat({
  transport,
  initialMessages: [], // Optional: restore from server
  onError: (error) => console.error(error),
  onFinish: () => console.log('Done'),
  onResourceUpdate: (name, value) => console.log(`Resource ${name}:`, value),
});
```

### Sending Messages

```typescript
// Text message
await chat.send('user-message', { USER_MESSAGE: message }, { userMessage: { content: message } });

// With file attachments
await chat.send(
  'user-message',
  { USER_MESSAGE: message, FILES: fileRefs },
  { userMessage: { content: message, files: fileRefs } },
);
```

### State Properties

```typescript
chat.messages; // UIMessage[] - all messages
chat.status; // 'idle' | 'streaming' | 'error'
chat.error; // OctavusError | null
```

### Stopping Generation

```typescript
chat.stop(); // Stops streaming and finalizes partial content
```

## File Uploads

```typescript
// Upload files separately (for progress tracking)
const fileRefs = await chat.uploadFiles(fileInput.files, (index, progress) => {
  console.log(`File ${index}: ${progress}%`);
});

// Use the references in a message
await chat.send('user-message', { FILES: fileRefs }, { userMessage: { files: fileRefs } });
```

Note: File uploads require configuring `requestUploadUrls` in the chat options.

## Message Types

Messages contain ordered `parts` with typed content:

```typescript
type UIMessagePart =
  | UITextPart // Text content with streaming status
  | UIReasoningPart // Model reasoning/thinking content
  | UIToolCallPart // Tool call with args, result, and status
  | UIOperationPart // Internal operations (e.g., set-resource)
  | UISourcePart // URL or document sources
  | UIFilePart // File attachments (uploaded or generated)
  | UIObjectPart; // Structured output objects
```

Each part includes a `type` discriminator and relevant fields. See TypeScript types for full field definitions.

## Error Handling

Errors are structured with type classification:

```typescript
import { isRateLimitError, isAuthenticationError } from '@octavus/client-sdk';

const chat = new OctavusChat({
  transport,
  onError: (error) => {
    if (isRateLimitError(error)) {
      showRetryButton(error.retryAfter);
    } else if (isAuthenticationError(error)) {
      redirectToLogin();
    }
  },
});
```

## Re-exports

This package re-exports everything from `@octavus/core`, so you don't need to install it separately.

## Related Packages

- [`@octavus/react`](https://www.npmjs.com/package/@octavus/react) - React hooks and bindings
- [`@octavus/server-sdk`](https://www.npmjs.com/package/@octavus/server-sdk) - Server-side SDK
- [`@octavus/core`](https://www.npmjs.com/package/@octavus/core) - Shared types

## License

MIT
