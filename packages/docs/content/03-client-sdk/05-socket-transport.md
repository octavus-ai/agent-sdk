---
title: Socket Transport
description: Using WebSocket or SockJS for real-time streaming with Octavus.
---

# Socket Transport

The socket transport enables real-time bidirectional communication using WebSocket or SockJS. Use this when you need persistent connections, custom server events, or when HTTP/SSE isn't suitable for your infrastructure.

## When to Use Socket Transport

| Use Case                                    | Recommended Transport            |
| ------------------------------------------- | -------------------------------- |
| Standard web apps (Next.js, etc.)           | HTTP (`createHttpTransport`)     |
| Real-time apps with custom events           | Socket (`createSocketTransport`) |
| Apps behind proxies that don't support SSE  | Socket                           |
| Need for typing indicators, presence, etc.  | Socket                           |
| Meteor, Phoenix, or socket-based frameworks | Socket                           |

## Connection Lifecycle

By default, socket transport uses **lazy connection** — the socket connects only when you first call `send()`. This is efficient but can be surprising if you want to show connection status.

For UI indicators, use **eager connection**:

```typescript
import { useEffect, useMemo } from 'react';
import SockJS from 'sockjs-client';
import { useOctavusChat, createSocketTransport, type SocketLike } from '@octavus/react';

function Chat() {
  const transport = useMemo(
    () => createSocketTransport({
      connect: () => new Promise((resolve, reject) => {
        const sock = new SockJS('/octavus');
        sock.onopen = () => resolve(sock);
        sock.onerror = () => reject(new Error('Connection failed'));
      }),
    }),
    [],
  );

  const {
    messages,
    status,
    send,
    // Socket-specific connection state
    connectionState,   // 'disconnected' | 'connecting' | 'connected' | 'error'
    connectionError,   // Error object if connectionState is 'error'
    connect,           // () => Promise<void>
    disconnect,        // () => void
  } = useOctavusChat({ transport });

  // Eagerly connect on mount
  useEffect(() => {
    connect?.();
    return () => disconnect?.();
  }, [connect, disconnect]);

  return (
    <div>
      <ConnectionIndicator state={connectionState} />
      {/* Chat UI */}
    </div>
  );
}
```

### Connection States

| State          | Description                                           |
| -------------- | ----------------------------------------------------- |
| `disconnected` | Not connected (initial state or after `disconnect()`) |
| `connecting`   | Connection attempt in progress                        |
| `connected`    | Socket is open and ready                              |
| `error`        | Connection failed (check `connectionError`)           |

## Patterns Overview

There are two main patterns for socket-based integrations:

| Pattern                                                         | When to Use                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Server-Managed Sessions](#server-managed-sessions-recommended) | **Recommended.** Server creates sessions lazily. Client doesn't need sessionId. |
| [Client-Provided Session ID](#client-provided-session-id)       | When client must control session creation or pass sessionId from URL.           |

## Server-Managed Sessions (Recommended)

The cleanest pattern is to have the server manage session lifecycle. The client never needs to know about `sessionId` — the server creates it lazily on first message.

### Client Setup

```typescript
import { useEffect, useMemo } from 'react';
import SockJS from 'sockjs-client';
import { useOctavusChat, createSocketTransport, type SocketLike } from '@octavus/react';

function connectSocket(): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    const sock = new SockJS('/octavus');
    sock.onopen = () => resolve(sock);
    sock.onerror = () => reject(new Error('Connection failed'));
  });
}

function Chat() {
  // Transport is stable — no dependencies on sessionId
  const transport = useMemo(() => createSocketTransport({ connect: connectSocket }), []);

  const { messages, status, send, stop, connectionState, connect, disconnect } = useOctavusChat({
    transport,
  });

  // Eagerly connect for UI status indicator
  useEffect(() => {
    connect?.();
    return () => disconnect?.();
  }, [connect, disconnect]);

  const sendMessage = async (text: string) => {
    await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });
  };

  // ... render chat UI
}
```

### Server Setup (Express + SockJS)

The server creates a session on first trigger message:

```typescript
import sockjs from 'sockjs';
import { OctavusClient, type AgentSession, type SocketMessage } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
});

function createSocketHandler() {
  return (conn: sockjs.Connection) => {
    let session: AgentSession | null = null;

    const send = (data: unknown) => conn.write(JSON.stringify(data));

    conn.on('data', (rawData: string) => {
      void handleMessage(rawData);
    });

    async function handleMessage(rawData: string) {
      const msg = JSON.parse(rawData);

      if (msg.type === 'trigger' || msg.type === 'continue' || msg.type === 'stop') {
        // Create session lazily on first trigger
        if (!session && msg.type === 'trigger') {
          const sessionId = await client.agentSessions.create('your-agent-id', {
            COMPANY_NAME: 'Acme Corp',
          });
          session = client.agentSessions.attach(sessionId, {
            tools: {
              // Server-side tool handlers only
              // Tools without handlers are forwarded to the client
            },
          });
        }

        if (!session) return;

        // handleSocketMessage manages abort controller internally
        await session.handleSocketMessage(msg as SocketMessage, {
          onEvent: send,
        });
      }
    }

    conn.on('close', () => {});
  };
}

const sockServer = sockjs.createServer({ prefix: '/octavus' });
sockServer.on('connection', createSocketHandler());
sockServer.installHandlers(httpServer);
```

**Benefits of this pattern:**

- Client code is simple — no sessionId management
- No transport caching issues
- Session is created only when needed
- Server controls session configuration

## Client-Provided Session ID

If you need the client to control the session (e.g., resuming a specific session from URL), pass the sessionId in an init message after connecting:

```typescript
import { useMemo } from 'react';
import SockJS from 'sockjs-client';
import { useOctavusChat, createSocketTransport, type SocketLike } from '@octavus/react';

function Chat({ sessionId }: { sessionId: string }) {
  const transport = useMemo(
    () =>
      createSocketTransport({
        connect: () =>
          new Promise((resolve, reject) => {
            const sock = new SockJS('/octavus');
            sock.onopen = () => {
              // Send init message with sessionId
              sock.send(JSON.stringify({ type: 'init', sessionId }));
              resolve(sock);
            };
            sock.onerror = () => reject(new Error('Connection failed'));
          }),
      }),
    [sessionId],
  );

  const { messages, status, send } = useOctavusChat({ transport });
  // ... render chat
}
```

When `sessionId` changes, the hook automatically reinitializes with the new transport.

### Server Handler with Init Message

When using client-provided sessionId, the server must handle an `init` message:

```typescript
import type { SocketMessage } from '@octavus/server-sdk';

sockServer.on('connection', (conn) => {
  let session: AgentSession | null = null;

  const send = (data: unknown) => conn.write(JSON.stringify(data));

  conn.on('data', (rawData: string) => {
    void handleMessage(rawData);
  });

  async function handleMessage(rawData: string) {
    const msg = JSON.parse(rawData);

    // Handle session initialization
    if (msg.type === 'init') {
      session = client.agentSessions.attach(msg.sessionId, {
        tools: {
          // Server-side tool handlers
        },
      });
      return;
    }

    // All other messages require initialized session
    if (!session) {
      send({
        type: 'error',
        errorType: 'validation_error',
        message: 'Session not initialized. Send init message first.',
        source: 'platform',
        retryable: false,
      });
      return;
    }

    // handleSocketMessage handles trigger, continue, and stop
    if (msg.type === 'trigger' || msg.type === 'continue' || msg.type === 'stop') {
      await session.handleSocketMessage(msg as SocketMessage, {
        onEvent: send,
      });
    }
  }
});
```

## Async Session ID

When the session ID is fetched asynchronously (e.g., from an API), you have two options:

### Option 1: Conditionally Render (Recommended)

Don't render the chat component until `sessionId` is available:

```tsx
function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    api.createSession().then((res) => setSessionId(res.sessionId));
  }, []);

  // Don't render until sessionId is ready
  if (!sessionId) {
    return <LoadingSpinner />;
  }

  return <Chat sessionId={sessionId} />;
}
```

This is the cleanest approach — the `Chat` component always receives a valid `sessionId`.

### Option 2: Server-Managed Sessions

Use the [server-managed sessions pattern](#server-managed-sessions-recommended) where the server creates the session lazily. The client never needs to know about `sessionId`.

## Native WebSocket

If you're using native WebSocket instead of SockJS, you can pass sessionId via URL:

```typescript
const transport = useMemo(
  () =>
    createSocketTransport({
      connect: () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`wss://your-server.com/octavus?sessionId=${sessionId}`);
          ws.onopen = () => resolve(ws);
          ws.onerror = () => reject(new Error('WebSocket connection failed'));
        }),
    }),
  [sessionId],
);
```

When `sessionId` changes, the hook automatically reinitializes with the new transport.

## Custom Events

Handle custom events alongside Octavus stream events:

```typescript
const transport = createSocketTransport({
  connect: connectSocket,

  onMessage: (data) => {
    const msg = data as { type: string; [key: string]: unknown };

    switch (msg.type) {
      case 'typing-indicator':
        setAgentTyping(msg.isTyping as boolean);
        break;

      case 'presence-update':
        setOnlineUsers(msg.users as string[]);
        break;

      case 'notification':
        showToast(msg.message as string);
        break;

      // Octavus events (text-delta, finish, etc.) are handled automatically
    }
  },
});
```

## Connection Management

### Connection State API

The socket transport provides full connection lifecycle control:

```typescript
const transport = createSocketTransport({
  connect: () =>
    new Promise((resolve, reject) => {
      const sock = new SockJS('/octavus');
      sock.onopen = () => resolve(sock);
      sock.onerror = () => reject(new Error('Connection failed'));
    }),
});

// Access connection state
console.log(transport.connectionState); // 'disconnected' | 'connecting' | 'connected' | 'error'

// Subscribe to state changes
const unsubscribe = transport.onConnectionStateChange((state, error) => {
  console.log('Connection state:', state);
  if (error) console.error('Error:', error);
});

// Eager connection
await transport.connect();

// Manual disconnect
transport.disconnect();
```

### Using with useOctavusChat

The React hook exposes connection state automatically for socket transports:

```typescript
const {
  messages,
  status,
  send,
  // Socket-specific (undefined for HTTP transport)
  connectionState,
  connectionError,
  connect,
  disconnect,
} = useOctavusChat({ transport });

// Eagerly connect on mount
useEffect(() => {
  connect?.();
  return () => disconnect?.();
}, [connect, disconnect]);
```

### Handling Disconnections

```typescript
const transport = createSocketTransport({
  connect: connectSocket,

  onClose: () => {
    console.log('Socket disconnected');
    // Connection state is automatically updated to 'disconnected'
  },
});
```

### Reconnection with Exponential Backoff

```typescript
import { useRef, useCallback, useMemo } from 'react';
import { createSocketTransport, type SocketLike } from '@octavus/react';

function useReconnectingTransport() {
  const reconnectAttempts = useRef(0);
  const maxAttempts = 5;

  const connect = useCallback((): Promise<SocketLike> => {
    return new Promise((resolve, reject) => {
      const sock = new SockJS('/octavus');

      sock.onopen = () => {
        reconnectAttempts.current = 0;
        resolve(sock);
      };

      sock.onerror = () => {
        if (reconnectAttempts.current < maxAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
          console.log(`Reconnecting in ${delay}ms...`);
          setTimeout(() => connect().then(resolve).catch(reject), delay);
        } else {
          reject(new Error('Max reconnection attempts reached'));
        }
      };
    });
  }, []);

  return useMemo(() => createSocketTransport({ connect }), [connect]);
}
```

## Framework Notes

### Meteor

Meteor's bundler may have issues with ES6 imports of `sockjs-client`. Use `require()` instead:

```typescript
// ❌ May fail in Meteor
import SockJS from 'sockjs-client';

// ✅ Works in Meteor
const SockJS: typeof import('sockjs-client') = require('sockjs-client');
```

### SockJS vs WebSocket

| Feature             | WebSocket            | SockJS                           |
| ------------------- | -------------------- | -------------------------------- |
| Browser support     | Modern browsers      | All browsers (with fallbacks)    |
| Session ID          | Via URL query params | Via init message                 |
| Proxy compatibility | Varies               | Excellent (polling fallback)     |
| Setup complexity    | Lower                | Higher (requires server library) |

## Protocol Reference

### Client → Server Messages

```typescript
// Initialize session (only for client-provided sessionId pattern)
{ type: 'init', sessionId: string }

// Trigger an action (start a new conversation turn)
{ type: 'trigger', triggerName: string, input?: Record<string, unknown> }

// Continue execution (after client-side tool handling)
{ type: 'continue', executionId: string, toolResults: ToolResult[] }

// Stop current stream
{ type: 'stop' }
```

### Server → Client Messages

The server sends Octavus `StreamEvent` objects as JSON. See [Streaming Events](/docs/server-sdk/streaming#event-types) for the full list.

```typescript
// Examples
{ type: 'start', messageId: '...', executionId: '...' }
{ type: 'text-delta', id: '...', delta: 'Hello' }
{ type: 'tool-input-start', toolCallId: '...', toolName: 'get-user' }
{ type: 'finish', finishReason: 'stop' }
{ type: 'error', errorType: 'internal_error', message: 'Something went wrong', source: 'platform', retryable: false }

// Client tool request (tools without server handlers)
{ type: 'client-tool-request', executionId: '...', toolCalls: [...], serverToolResults: [...] }
{ type: 'finish', finishReason: 'client-tool-calls', executionId: '...' }
```

When a `client-tool-request` event is received, the client handles the tools and sends a `continue` message to resume.

## Full Example

For a complete walkthrough of building a chat interface with SockJS, see the [Socket Chat Example](/docs/examples/socket-chat).
