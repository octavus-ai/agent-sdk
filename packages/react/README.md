# @octavus/react

React bindings for Octavus agents.

## Installation

```bash
npm install @octavus/react
```

## Overview

This package provides React hooks for interacting with Octavus agents. It wraps `@octavus/client-sdk` with React state management using `useSyncExternalStore` for proper React 18+ integration.

## Quick Start

```tsx
import { useMemo } from 'react';
import { useOctavusChat, createHttpTransport } from '@octavus/react';

function Chat({ sessionId }: { sessionId: string }) {
  const transport = useMemo(
    () =>
      createHttpTransport({
        request: (req, options) =>
          fetch('/api/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, ...req }),
            signal: options?.signal,
          }),
      }),
    [sessionId],
  );

  const { messages, status, send } = useOctavusChat({ transport });

  const handleSend = async (message: string) => {
    await send('user-message', { USER_MESSAGE: message }, { userMessage: { content: message } });
  };

  return (
    <div>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <ChatInput onSend={handleSend} disabled={status === 'streaming'} />
    </div>
  );
}
```

## useOctavusChat Hook

### Options

```typescript
const { messages, status, error, send, stop } = useOctavusChat({
  transport, // Required: HTTP or Socket transport
  initialMessages: [], // Optional: restore messages from server
  onError: (error) => {}, // Optional: error callback
  onFinish: () => {}, // Optional: completion callback
  onResourceUpdate: (name, value) => {}, // Optional: resource update callback
});
```

### Return Values

| Property      | Type                               | Description                                        |
| ------------- | ---------------------------------- | -------------------------------------------------- |
| `messages`    | `UIMessage[]`                      | All messages including the currently streaming one |
| `status`      | `'idle' \| 'streaming' \| 'error'` | Current chat status                                |
| `error`       | `OctavusError \| null`             | Structured error if status is 'error'              |
| `send`        | `function`                         | Send a message to the agent                        |
| `stop`        | `function`                         | Stop streaming and finalize partial content        |
| `uploadFiles` | `function`                         | Upload files with progress tracking                |

### Socket Transport Extensions

When using `createSocketTransport`, additional properties are available:

| Property          | Type                 | Description                                                |
| ----------------- | -------------------- | ---------------------------------------------------------- |
| `connectionState` | `ConnectionState`    | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `connectionError` | `Error \| undefined` | Connection error if state is 'error'                       |
| `connect`         | `function`           | Eagerly establish connection                               |
| `disconnect`      | `function`           | Close the connection                                       |

## Transports

### HTTP Transport

```typescript
import { createHttpTransport } from '@octavus/react';

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

### Socket Transport

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

## File Uploads

```tsx
const { send, uploadFiles } = useOctavusChat({ transport, requestUploadUrls });

// Upload with progress tracking
const handleFileSelect = async (files: FileList) => {
  const fileRefs = await uploadFiles(files, (index, progress) => {
    console.log(`File ${index}: ${progress}%`);
  });

  await send('user-message', { FILES: fileRefs }, { userMessage: { files: fileRefs } });
};
```

## Error Handling

```tsx
import { useOctavusChat, isRateLimitError, isProviderError } from '@octavus/react';

function Chat() {
  const { error, status } = useOctavusChat({
    transport,
    onError: (error) => {
      if (isRateLimitError(error)) {
        toast(`Rate limited. Retry in ${error.retryAfter}s`);
      } else if (isProviderError(error)) {
        toast(`Provider error: ${error.provider?.name}`);
      }
    },
  });

  return status === 'error' && <ErrorBanner error={error} />;
}
```

## Re-exports

This package re-exports everything from `@octavus/client-sdk` and `@octavus/core`, so you don't need to install them separately.

## Related Packages

- [`@octavus/client-sdk`](https://www.npmjs.com/package/@octavus/client-sdk) - Framework-agnostic client SDK
- [`@octavus/server-sdk`](https://www.npmjs.com/package/@octavus/server-sdk) - Server-side SDK
- [`@octavus/core`](https://www.npmjs.com/package/@octavus/core) - Shared types

## License

MIT
