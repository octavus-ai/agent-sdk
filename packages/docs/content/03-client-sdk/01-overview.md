---
title: Overview
description: Introduction to the Octavus Client SDKs for building chat interfaces.
---

# Client SDK Overview

Octavus provides two packages for frontend integration:

| Package               | Purpose                  | Use When                                              |
| --------------------- | ------------------------ | ----------------------------------------------------- |
| `@octavus/react`      | React hooks and bindings | Building React applications                           |
| `@octavus/client-sdk` | Framework-agnostic core  | Using Vue, Svelte, vanilla JS, or custom integrations |

**Most users should install `@octavus/react`** — it includes everything from `@octavus/client-sdk` plus React-specific hooks.

## Installation

### React Applications

```bash
npm install @octavus/react
```

**Current version:** `{{VERSION:@octavus/react}}`

### Other Frameworks

```bash
npm install @octavus/client-sdk
```

**Current version:** `{{VERSION:@octavus/client-sdk}}`

## Transport Pattern

The Client SDK uses a **transport abstraction** to handle communication with your backend. This gives you flexibility in how events are delivered:

| Transport               | Use Case                                     | Docs                                                  |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `createHttpTransport`   | HTTP/SSE (Next.js, Express, etc.)            | [HTTP Transport](/docs/client-sdk/http-transport)     |
| `createSocketTransport` | WebSocket, SockJS, or other socket protocols | [Socket Transport](/docs/client-sdk/socket-transport) |

When the transport changes (e.g., when `sessionId` changes), the `useOctavusChat` hook automatically reinitializes with the new transport.

> **Recommendation**: Use HTTP transport unless you specifically need WebSocket features (custom real-time events, Meteor/Phoenix, etc.).

## React Usage

The `useOctavusChat` hook provides state management and streaming for React applications:

```tsx
import { useMemo } from 'react';
import { useOctavusChat, createHttpTransport, type UIMessage } from '@octavus/react';

function Chat({ sessionId }: { sessionId: string }) {
  // Create a stable transport instance (memoized on sessionId)
  const transport = useMemo(
    () =>
      createHttpTransport({
        request: (payload, options) =>
          fetch('/api/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, ...payload }),
            signal: options?.signal,
          }),
      }),
    [sessionId],
  );

  const { messages, status, send } = useOctavusChat({ transport });

  const sendMessage = async (text: string) => {
    await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });
  };

  return (
    <div>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return <p key={i}>{part.text}</p>;
        }
        return null;
      })}
    </div>
  );
}
```

## Framework-Agnostic Usage

The `OctavusChat` class can be used with any framework or vanilla JavaScript:

```typescript
import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';

const transport = createHttpTransport({
  request: (payload, options) =>
    fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
      signal: options?.signal,
    }),
});

const chat = new OctavusChat({ transport });

// Subscribe to state changes
const unsubscribe = chat.subscribe(() => {
  console.log('Messages:', chat.messages);
  console.log('Status:', chat.status);
  // Update your UI here
});

// Send a message
await chat.send('user-message', { USER_MESSAGE: 'Hello' }, { userMessage: { content: 'Hello' } });

// Cleanup when done
unsubscribe();
```

## Key Features

### Unified Send Function

The `send` function handles both user message display and agent triggering in one call:

```tsx
const { send } = useOctavusChat({ transport });

// Add user message to UI and trigger agent
await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });

// Trigger without adding a user message (e.g., button click)
await send('request-human');
```

### Message Parts

Messages contain ordered `parts` for rich content:

```tsx
const { messages } = useOctavusChat({ transport });

// Each message has typed parts
message.parts.map((part) => {
  switch (part.type) {
    case 'text': // Text content
    case 'reasoning': // Extended reasoning/thinking
    case 'tool-call': // Tool execution
    case 'operation': // Internal operations (set-resource, etc.)
  }
});
```

### Status Tracking

```tsx
const { status } = useOctavusChat({ transport });

// status: 'idle' | 'streaming' | 'error' | 'awaiting-input'
// 'awaiting-input' occurs when interactive client tools need user action
```

### Stop Streaming

```tsx
const { stop } = useOctavusChat({ transport });

// Stop current stream and finalize message
stop();
```

### Retry Last Trigger

Re-execute the last trigger from the same starting point. Messages are rolled back to the state before the trigger, the user message is re-added (if any), and the agent re-executes. Already-uploaded files are reused without re-uploading.

```tsx
const { retry, canRetry } = useOctavusChat({ transport });

// Retry after an error, cancellation, or unsatisfactory result
if (canRetry) {
  await retry();
}
```

`canRetry` is `true` when a trigger has been sent and the chat is not currently streaming or awaiting input.

## Hook Reference (React)

### useOctavusChat

```typescript
function useOctavusChat(options: OctavusChatOptions): UseOctavusChatReturn;

interface OctavusChatOptions {
  // Required: Transport for streaming events
  transport: Transport;

  // Optional: Function to request upload URLs for file uploads
  requestUploadUrls?: (
    files: { filename: string; mediaType: string; size: number }[],
  ) => Promise<UploadUrlsResponse>;

  // Optional: Client-side tool handlers
  // - Function: executes automatically and returns result
  // - 'interactive': appears in pendingClientTools for user input
  clientTools?: Record<string, ClientToolHandler>;

  // Optional: Pre-populate with existing messages (session restore)
  initialMessages?: UIMessage[];

  // Optional: Callbacks
  onError?: (error: OctavusError) => void; // Structured error with type, source, retryable
  onFinish?: () => void;
  onStop?: () => void; // Called when user stops generation
  onResourceUpdate?: (name: string, value: unknown) => void;
}

interface UseOctavusChatReturn {
  // State
  messages: UIMessage[];
  status: ChatStatus; // 'idle' | 'streaming' | 'error' | 'awaiting-input'
  error: OctavusError | null; // Structured error with type, source, retryable

  // Connection (socket transport only - undefined for HTTP)
  connectionState: ConnectionState | undefined; // 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionError: Error | undefined;

  // Client tools (interactive tools awaiting user input)
  pendingClientTools: Record<string, InteractiveTool[]>; // Keyed by tool name

  // Actions
  send: (
    triggerName: string,
    input?: Record<string, unknown>,
    options?: { userMessage?: UserMessageInput },
  ) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>; // Retry last trigger from same starting point
  canRetry: boolean; // Whether retry() can be called

  // Connection management (socket transport only - undefined for HTTP)
  connect: (() => Promise<void>) | undefined;
  disconnect: (() => void) | undefined;

  // File uploads (requires requestUploadUrls)
  uploadFiles: (
    files: FileList | File[],
    onProgress?: (fileIndex: number, progress: number) => void,
  ) => Promise<FileReference[]>;
}

interface UserMessageInput {
  content?: string;
  files?: FileList | File[] | FileReference[];
}
```

## Transport Reference

### createHttpTransport

Creates an HTTP/SSE transport using native `fetch()`:

```typescript
import { createHttpTransport } from '@octavus/react';

const transport = createHttpTransport({
  request: (payload, options) =>
    fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
      signal: options?.signal,
    }),
});
```

### createSocketTransport

Creates a WebSocket/SockJS transport for real-time connections:

```typescript
import { createSocketTransport } from '@octavus/react';

const transport = createSocketTransport({
  connect: () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://api.example.com/stream?sessionId=${sessionId}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('Connection failed'));
    }),
});
```

Socket transport provides additional connection management:

```typescript
// Access connection state directly
transport.connectionState; // 'disconnected' | 'connecting' | 'connected' | 'error'

// Subscribe to state changes
transport.onConnectionStateChange((state, error) => {
  /* ... */
});

// Eager connection (instead of lazy on first send)
await transport.connect();

// Manual disconnect
transport.disconnect();
```

For detailed WebSocket/SockJS usage including custom events, reconnection patterns, and server-side implementation, see [Socket Transport](/docs/client-sdk/socket-transport).

## Class Reference (Framework-Agnostic)

### OctavusChat

```typescript
class OctavusChat {
  constructor(options: OctavusChatOptions);

  // State (read-only)
  readonly messages: UIMessage[];
  readonly status: ChatStatus; // 'idle' | 'streaming' | 'error' | 'awaiting-input'
  readonly error: OctavusError | null; // Structured error
  readonly pendingClientTools: Record<string, InteractiveTool[]>; // Interactive tools

  // Actions
  send(
    triggerName: string,
    input?: Record<string, unknown>,
    options?: { userMessage?: UserMessageInput },
  ): Promise<void>;
  stop(): void;

  // Subscription
  subscribe(callback: () => void): () => void; // Returns unsubscribe function
}
```

## Next Steps

- [HTTP Transport](/docs/client-sdk/http-transport) — HTTP/SSE integration (recommended)
- [Socket Transport](/docs/client-sdk/socket-transport) — WebSocket and SockJS integration
- [Messages](/docs/client-sdk/messages) — Working with message state
- [Streaming](/docs/client-sdk/streaming) — Building streaming UIs
- [Client Tools](/docs/client-sdk/client-tools) — Interactive browser-side tool handling
- [Operations](/docs/client-sdk/execution-blocks) — Showing agent progress
- [Error Handling](/docs/client-sdk/error-handling) — Handling errors with type guards
- [File Uploads](/docs/client-sdk/file-uploads) — Uploading images and documents
- [Examples](/docs/examples/overview) — Complete working examples
