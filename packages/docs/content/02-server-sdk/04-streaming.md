---
title: Streaming
description: Understanding stream events from the Server SDK.
---

# Streaming

All Octavus responses stream in real-time using Server-Sent Events (SSE). This enables responsive UX with incremental updates.

## Stream Response

When you execute a request, you get an async generator of parsed events:

```typescript
import { toSSEStream } from '@octavus/server-sdk';

// execute() returns an async generator of StreamEvent
const events = session.execute({
  type: 'trigger',
  triggerName: 'user-message',
  input: { USER_MESSAGE: 'Hello!' },
});

// For HTTP endpoints, convert to SSE stream
return new Response(toSSEStream(events), {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
});

// For sockets, iterate events directly
for await (const event of events) {
  conn.write(JSON.stringify(event));
}
```

The `X-Accel-Buffering: no` header disables proxy buffering on Nginx-based infrastructure (including Vercel), ensuring SSE events are forwarded immediately instead of being batched.

### Heartbeat

`toSSEStream` automatically sends SSE comment lines (`: heartbeat`) every 15 seconds during idle periods. This prevents proxies and load balancers from closing the connection due to inactivity — particularly important during multi-step executions where the stream may be silent while waiting for tool processing or LLM responses.

Heartbeat comments are ignored by all SSE parsers per the spec. No client-side handling is needed.

## Event Types

The stream emits various event types for lifecycle, text, reasoning, and tool interactions.

### Lifecycle Events

```typescript
// Stream started
{ type: 'start', messageId: '...', executionId: '...' }

// Stream completed
{ type: 'finish', finishReason: 'stop' }

// Possible finish reasons:
// - 'stop': Normal completion
// - 'tool-calls': Waiting for server tool execution (handled by SDK internally)
// - 'client-tool-calls': Waiting for client tool execution
// - 'length': Max tokens reached
// - 'content-filter': Content filtered
// - 'error': Error occurred
// - 'other': Other reason

// Error event (see Error Handling docs for full structure)
{ type: 'error', errorType: 'internal_error', message: 'Something went wrong', source: 'platform', retryable: false }
```

### Block Events

Track execution progress:

```typescript
// Block started
{ type: 'block-start', blockId: '...', blockName: 'Respond to user', blockType: 'next-message', display: 'stream', thread: 'main' }

// Block completed
{ type: 'block-end', blockId: '...', summary: 'Generated response' }
```

### Text Events

Streaming text content:

```typescript
// Text generation started
{ type: 'text-start', id: '...' }

// Incremental text (most common event)
{ type: 'text-delta', id: '...', delta: 'Hello' }
{ type: 'text-delta', id: '...', delta: '!' }
{ type: 'text-delta', id: '...', delta: ' How' }
{ type: 'text-delta', id: '...', delta: ' can' }
{ type: 'text-delta', id: '...', delta: ' I' }
{ type: 'text-delta', id: '...', delta: ' help?' }

// Text generation ended
{ type: 'text-end', id: '...' }
```

### Reasoning Events

Extended reasoning (for supported models like Claude):

```typescript
// Reasoning started
{ type: 'reasoning-start', id: '...' }

// Reasoning content
{ type: 'reasoning-delta', id: '...', delta: 'Let me analyze this request...' }

// Reasoning ended
{ type: 'reasoning-end', id: '...' }
```

### Tool Events

Tool call lifecycle:

```typescript
// Tool input started
{ type: 'tool-input-start', toolCallId: '...', toolName: 'get-user-account', title: 'Looking up account' }

// Tool input/arguments streaming
{ type: 'tool-input-delta', toolCallId: '...', inputTextDelta: '{"userId":"user-123"}' }

// Tool input streaming ended
{ type: 'tool-input-end', toolCallId: '...' }

// Tool input is complete and available
{ type: 'tool-input-available', toolCallId: '...', toolName: 'get-user-account', input: { userId: 'user-123' } }

// Tool output available (success)
{ type: 'tool-output-available', toolCallId: '...', output: { name: 'Demo User', email: '...' } }

// Tool output error (failure)
{ type: 'tool-output-error', toolCallId: '...', error: 'User not found' }
```

### Resource Events

Resource updates:

```typescript
{ type: 'resource-update', name: 'CONVERSATION_SUMMARY', value: 'User asked about...' }
```

## Display Modes

Each block/tool specifies how it should appear to users:

| Mode          | Description                         |
| ------------- | ----------------------------------- |
| `hidden`      | Not shown to user (background work) |
| `name`        | Shows block/tool name               |
| `description` | Shows description text              |
| `stream`      | Streams content to chat             |

**Note**: Hidden events are filtered before reaching the client SDK. Your frontend only sees user-facing events.

## Stream Event Type

```typescript
type StreamEvent =
  // Lifecycle
  | StartEvent
  | FinishEvent
  | ErrorEvent
  // Text
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  // Reasoning
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  // Tool Input/Output
  | ToolInputStartEvent
  | ToolInputDeltaEvent
  | ToolInputEndEvent
  | ToolInputAvailableEvent
  | ToolOutputAvailableEvent
  | ToolOutputErrorEvent
  // Octavus-Specific
  | BlockStartEvent
  | BlockEndEvent
  | ResourceUpdateEvent
  | ToolRequestEvent
  | ClientToolRequestEvent;
```

### Client Tool Request

When a tool has no server handler registered, the SDK emits a `client-tool-request` event:

```typescript
{
  type: 'client-tool-request',
  executionId: 'exec_abc123',       // Use this to continue execution
  toolCalls: [                       // Tools for client to handle
    {
      toolCallId: 'call_xyz',
      toolName: 'get-browser-location',
      args: {}
    }
  ],
  serverToolResults: [               // Results from server tools in same batch
    {
      toolCallId: 'call_def',
      toolName: 'get-user-account',
      result: { name: 'Demo User' }
    }
  ]
}
```

After the client handles the tools, send a `continue` request with all results:

```typescript
session.execute({
  type: 'continue',
  executionId: 'exec_abc123',
  toolResults: [
    ...serverToolResults, // Include server results from the event
    {
      toolCallId: 'call_xyz',
      toolName: 'get-browser-location',
      result: { lat: 40.7128, lng: -74.006 },
    },
  ],
});
```

See [Client Tools](/docs/client-sdk/client-tools) for full client-side implementation.

## Error Events

Errors are emitted as structured events with type classification:

```typescript
{
  type: 'error',
  errorType: 'rate_limit_error',     // Error classification
  message: 'Rate limit exceeded',     // Human-readable message
  source: 'provider',                 // 'platform' | 'provider' | 'tool'
  retryable: true,                    // Whether retry is possible
  retryAfter: 60,                     // Seconds to wait (rate limits)
  code: 'ANTHROPIC_429',              // Machine-readable code
  provider: {                         // Provider details (when applicable)
    name: 'anthropic',
    statusCode: 429,
    requestId: 'req_...'
  }
}
```

### Error Types

| Type                   | Description           |
| ---------------------- | --------------------- |
| `rate_limit_error`     | Too many requests     |
| `authentication_error` | Invalid API key       |
| `provider_error`       | LLM provider issue    |
| `provider_overloaded`  | Provider at capacity  |
| `tool_error`           | Tool execution failed |
| `internal_error`       | Platform error        |

### Tool Errors

Tool errors are captured per-tool and don't stop the stream:

```typescript
{ type: 'tool-output-error', toolCallId: '...', error: 'Handler threw exception' }
```

The stream always ends with either `finish` or `error`.

For client-side error handling patterns, see [Error Handling](/docs/client-sdk/error-handling).
