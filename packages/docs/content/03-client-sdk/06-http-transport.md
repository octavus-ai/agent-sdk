---
title: HTTP Transport
description: Using HTTP/SSE for streaming with Octavus in Next.js, Express, and other frameworks.
---

# HTTP Transport

The HTTP transport uses standard HTTP requests with Server-Sent Events (SSE) for streaming. This is the simplest and most compatible transport option.

## When to Use HTTP Transport

| Use Case                                       | Recommendation                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Next.js, Remix, or similar frameworks          | ✅ Use HTTP                                                    |
| Standard web apps without special requirements | ✅ Use HTTP                                                    |
| Serverless deployments (Vercel, etc.)          | ✅ Use HTTP                                                    |
| Need custom real-time events                   | Consider [Socket Transport](/docs/client-sdk/socket-transport) |

## Basic Setup

### Client

```tsx
import { useMemo } from 'react';
import { useOctavusChat, createHttpTransport } from '@octavus/react';

function Chat({ sessionId }: { sessionId: string }) {
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

  const { messages, status, error, send, stop } = useOctavusChat({ transport });

  const sendMessage = async (text: string) => {
    await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });
  };

  // ... render chat
}
```

### Server (Next.js API Route)

```typescript
// app/api/trigger/route.ts
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
});

export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId, ...payload } = body;

  const session = client.agentSessions.attach(sessionId, {
    tools: {
      'get-user-account': async (args) => {
        return { name: 'Demo User', plan: 'pro' };
      },
    },
  });

  // execute() handles both triggers and client tool continuations
  const events = session.execute(payload, { signal: request.signal });

  return new Response(toSSEStream(events), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

## Session Creation

Sessions should be created server-side before rendering the chat. There are two patterns:

### Pattern 1: Create Session on Page Load

```tsx
// app/chat/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Chat } from '@/components/Chat';

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'your-agent-id',
        input: { COMPANY_NAME: 'Acme Corp' },
      }),
    })
      .then((res) => res.json())
      .then((data) => setSessionId(data.sessionId));
  }, []);

  if (!sessionId) {
    return <LoadingSpinner />;
  }

  return <Chat sessionId={sessionId} />;
}
```

### Pattern 2: Server-Side Session Creation (App Router)

```tsx
// app/chat/page.tsx
import { octavus } from '@/lib/octavus';
import { Chat } from '@/components/Chat';

export default async function ChatPage() {
  // Create session server-side
  const sessionId = await octavus.agentSessions.create('your-agent-id', {
    COMPANY_NAME: 'Acme Corp',
  });

  return <Chat sessionId={sessionId} />;
}
```

This pattern is cleaner as the session is ready before the component renders.

## Error Handling

Handle errors with structured error information:

```tsx
import { isRateLimitError, isProviderError } from '@octavus/react';

const { messages, status, error, send } = useOctavusChat({
  transport,
  onError: (err) => {
    console.error('Stream error:', err.errorType, err.message);

    if (isRateLimitError(err)) {
      toast.error(`Rate limited. Try again in ${err.retryAfter}s`);
    } else if (isProviderError(err)) {
      toast.error('AI service temporarily unavailable');
    } else {
      toast.error('Something went wrong');
    }
  },
});

// Also check error state
if (error) {
  return <ErrorMessage error={error} />;
}
```

See [Error Handling](/docs/client-sdk/error-handling) for comprehensive error handling patterns.

## Stop Streaming

Allow users to cancel ongoing streams. When `stop()` is called:

1. The HTTP request is aborted via the signal
2. Any partial content is preserved in the message
3. Tool calls in progress are marked as `cancelled`
4. Status changes to `idle`

```tsx
const { send, stop, status } = useOctavusChat({
  transport,
  onStop: () => {
    console.log('User stopped generation');
  },
});

return (
  <button
    onClick={status === 'streaming' ? stop : () => sendMessage()}
    disabled={status === 'streaming' && !inputValue}
  >
    {status === 'streaming' ? 'Stop' : 'Send'}
  </button>
);
```

> **Important**: For stop to work end-to-end, pass the `options.signal` to your `fetch()` call and forward `request.signal` to `session.execute()` on the server.

## Express Server

For non-Next.js backends:

```typescript
import express from 'express';
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';

const app = express();
app.use(express.json());

const client = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
});

app.post('/api/trigger', async (req, res) => {
  const { sessionId, ...payload } = req.body;

  const session = client.agentSessions.attach(sessionId, {
    tools: {
      // Server-side tool handlers only
      // Tools without handlers are forwarded to the client
    },
  });

  // execute() handles both triggers and continuations
  const events = session.execute(payload);
  const stream = toSSEStream(events);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Pipe the stream to the response
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
});
```

## Transport Options

```typescript
interface HttpTransportOptions {
  // Single request handler for both triggers and continuations
  request: (request: HttpRequest, options?: HttpRequestOptions) => Promise<Response>;
}

interface HttpRequestOptions {
  signal?: AbortSignal;
}

// Discriminated union for request types
type HttpRequest = TriggerRequest | ContinueRequest;

// Start a new conversation turn
interface TriggerRequest {
  type: 'trigger';
  triggerName: string;
  input?: Record<string, unknown>;
  rollbackAfterMessageId?: string | null; // For retry: truncate messages after this ID
}

// Continue after client-side tool handling
interface ContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}
```

The `request` function receives a discriminated union. Spread the request onto your payload:

```typescript
request: (payload, options) =>
  fetch('/api/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...payload }),
    signal: options?.signal,
  });
```

## Protocol

### Request Format

The `request` function receives a discriminated union with `type` to identify the request kind:

**Trigger Request** (start a new turn):

```json
{
  "sessionId": "sess_abc123",
  "type": "trigger",
  "triggerName": "user-message",
  "input": {
    "USER_MESSAGE": "Hello"
  }
}
```

**Continue Request** (after client tool handling):

```json
{
  "sessionId": "sess_abc123",
  "type": "continue",
  "executionId": "exec_xyz789",
  "toolResults": [
    {
      "toolCallId": "call_abc",
      "toolName": "get-browser-location",
      "result": { "lat": 40.7128, "lng": -74.006 }
    }
  ]
}
```

### Response Format

The server responds with an SSE stream:

```
data: {"type":"start","messageId":"msg_xyz","executionId":"exec_xyz789"}

data: {"type":"text-delta","id":"msg_xyz","delta":"Hello"}

data: {"type":"text-delta","id":"msg_xyz","delta":" there!"}

data: {"type":"finish","finishReason":"stop"}

data: [DONE]
```

If client tools are needed, the stream pauses with a `client-tool-request` event:

```
data: {"type":"client-tool-request","executionId":"exec_xyz789","toolCalls":[...]}

data: {"type":"finish","finishReason":"client-tool-calls","executionId":"exec_xyz789"}

data: [DONE]
```

The client handles the tools and sends a `continue` request to resume.

See [Streaming Events](/docs/server-sdk/streaming#event-types) for the full list of event types.

## Next Steps

- [Quick Start](/docs/getting-started/quickstart) - Complete Next.js integration guide
- [Client Tools](/docs/client-sdk/client-tools) - Handling tools on the client side
- [Messages](/docs/client-sdk/messages) - Working with message state
- [Streaming](/docs/client-sdk/streaming) - Building streaming UIs
- [Error Handling](/docs/client-sdk/error-handling) - Handling errors with type guards
