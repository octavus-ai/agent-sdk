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

`toSSEStream` automatically sends SSE comment lines (`: heartbeat`) every 15 seconds during idle periods. This prevents proxies and load balancers from closing the connection due to inactivity - particularly important during multi-step executions where the stream may be silent while waiting for tool processing or LLM responses.

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

### Step Events

A block that calls tools runs several model steps in one turn. Step events mark the boundaries between them and let the platform retract a step it has to redo:

```typescript
// A later model step is starting (never sent for a block's first step).
// The live counterpart of the `step-start` message part, so a message built
// from the stream has the same structure as one loaded from history.
{ type: 'step-start' }

// The current step's partial output is abandoned: drop everything streamed
// since the step began (after the last `step-start`, or since the block's
// output began). A fresh attempt at the same step streams next.
{ type: 'step-discard' }
```

`step-discard` is sent when the platform rolls a step back to re-issue it - for example when a transient provider failure interrupted the stream before anything from the step had executed. Only the interrupted step is affected; output committed by earlier steps stays. A client that ignores the event keeps the abandoned output and sees the retried step appended after it, which is why the [Client SDK](/docs/client-sdk/streaming) handles it for you.

### Text Events

Streaming text content:

```typescript
// Text generation started
{ type: 'text-start', id: '...' }

// Incremental text (most common event)
{ type: 'text-delta', id: '...', delta: 'Hello! How' }
{ type: 'text-delta', id: '...', delta: ' can I help?' }

// Text generation ended
{ type: 'text-end', id: '...' }
```

> **Delta granularity is provider-dependent.** Each `text-delta` is forwarded exactly as the model provider frames it. Some providers emit small, word-sized deltas; others (notably some Claude models) emit larger multi-token chunks, so text can arrive in lumps rather than a steady token-by-token stream. Do not assume a fixed delta size. To render text as smooth, continuous typing regardless of provider framing, see [Delivery Cadence](#delivery-cadence) below.

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

## Delivery Cadence

Raw `text-delta` (and `reasoning-delta`) granularity is set by the model provider, so it can be coarse - large multi-token lumps rather than a steady stream. Octavus gives you two independent, opt-in ways to get smooth, continuous rendering. They can be used alone or together:

- **Client-side smoothing (recommended for most UIs).** If you render through `@octavus/client-sdk` / `@octavus/react`, enable the built-in typewriter pacer. It paces already-received text onto the screen at a steady cadence with no wire cost and no added latency (it is flushed the moment a turn finishes). See [Client SDK -> Streaming](/docs/client-sdk/streaming).
- **Server-side (wire) smoothing.** If you consume the raw SSE stream in your own backend and render it elsewhere, you can have Octavus re-chunk the stream before it reaches you by declaring a streaming cadence in your agent config. This normalizes every provider uniformly.

### Server-side cadence (agent config)

Declare a `streaming` cadence on the agent (or a thread / a `next-message` block). When set, the runtime re-chunks visible text and reasoning into word- or line-sized deltas before sending them:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system-prompt
  streaming:
    chunking: word # off (default) | word | line
    delayMs: 15 # optional inter-chunk delay
```

- `chunking: off` (the default) forwards provider deltas unchanged - identical to today's behavior, no extra frames.
- `chunking: word` / `line` emit more, smaller SSE frames so downstream rendering looks like continuous typing. This is the expected trade-off of finer wire granularity: more (smaller) events over the wire.
- `delayMs` is an optional pause between emitted chunks, an integer between 0 and 100. Keep it small so a burst drains within the model's natural idle gap (avoids adding latency on fast models). Omit it for the built-in default.

Cadence is resolved with the standard `block > thread > agent` precedence, the same as `speed`. It does not apply to structured output (`responseType`) blocks, whose deltas carry JSON rather than prose.

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

> **Deprecated:** Resources (and `resource-update` events) are superseded by [tools](/docs/protocol/tools). Persist state with a consumer-defined tool instead. Still emitted for now.

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

The stream always ends with either `finish` or `error`, with one exception: worker executions emit a final `usage` event (the per-execution cost summary) after `finish`, just before the stream closes. See [Cost reporting](/docs/server-sdk/workers#cost-reporting).

For client-side error handling patterns, see [Error Handling](/docs/client-sdk/error-handling).
