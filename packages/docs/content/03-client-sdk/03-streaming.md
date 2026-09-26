---
title: Streaming
description: Building streaming UIs with the Client SDK.
---

# Streaming

The Client SDK provides real-time access to streaming content through the message `parts` array. Each part has its own status, enabling responsive UIs that update as the agent generates responses.

## Streaming State

```tsx
const { messages, status, error } = useOctavusChat({ transport });

// status: 'idle' | 'streaming' | 'error' | 'awaiting-input'
// 'awaiting-input' occurs when interactive client tools need user action
// Each message has status: 'streaming' | 'done'
// Each part has its own status too
```

## Smooth Text Rendering

Model providers frame their streams at different granularities. Some emit small, word-sized deltas; others emit large multi-token chunks, so text can land in visible lumps rather than a steady stream. To render assistant text (and reasoning) as smooth, continuous typing regardless of the provider, enable `textSmoothing`:

```tsx
// Word-level typewriter with sensible defaults
const chat = useOctavusChat({ transport, textSmoothing: true });

// Or customize granularity and base rate
const chat = useOctavusChat({
  transport,
  textSmoothing: { granularity: 'word', charsPerSecond: 80 }, // 'word' | 'char'
});
```

`textSmoothing` paces already-received text onto the screen from a small buffer, so provider bursts render as steady typing. It is purely a rendering choice:

- **No wire cost and no added latency.** Nothing is held back on the network; smoothing only spreads text into the gaps between provider bursts, and the buffer is flushed immediately on finish, stop, or error - so the final text always appears at once and completion is never delayed.
- **Adaptive.** The reveal rate scales with the backlog, so a fast model catches up instead of lagging behind.
- **Scoped to prose.** Only text and reasoning are paced; tool calls, structured output (`responseType`), and other parts render immediately. Late-join / reconnect replays paint the caught-up turn in one shot and then resume smooth rendering for new text.

`textSmoothing` defaults to `false` (off), so existing integrations are unchanged. It is independent from the server-side [streaming cadence](/docs/server-sdk/streaming#delivery-cadence): use `textSmoothing` when you render through this SDK, and the protocol `streaming` config when a backend consumes the raw wire and renders elsewhere.

## Building a Streaming UI

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

  return (
    <div>
      {/* Messages with streaming parts */}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Error state */}
      {error && <div className="text-red-500">{error.message}</div>}

      {/* Stop button during streaming */}
      {status === 'streaming' && <button onClick={stop}>Stop</button>}
    </div>
  );
}
```

## Rendering Streaming Parts

Parts update in real-time during streaming. Use the part's `status` to show appropriate UI:

```tsx
import type { UITextPart, UIReasoningPart } from '@octavus/react';

function TextPart({ part }: { part: UITextPart }) {
  return (
    <div>
      {part.text}
      {part.status === 'streaming' && (
        <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
      )}
    </div>
  );
}

function ReasoningPart({ part }: { part: UIReasoningPart }) {
  // Expand while streaming, collapse when done
  const [expanded, setExpanded] = useState(part.status === 'streaming');

  return (
    <div className="bg-purple-50 p-3 rounded-lg">
      <button onClick={() => setExpanded(!expanded)}>
        {part.status === 'streaming' ? '💭 Thinking...' : '💭 Thought process'}
        {expanded ? '▼' : '▶'}
      </button>

      {expanded && <pre className="mt-2 text-sm text-gray-600">{part.text}</pre>}
    </div>
  );
}
```

### Steps and retracted output

An agent that calls tools runs several model steps inside one assistant message. The SDK mirrors the platform's step structure into `parts`: a `step-start` part is inserted between steps as they stream (the same marker a message loaded from history carries - render it as nothing), so a live message and a reloaded one always have the same shape.

Occasionally the platform has to redo a step - for example when the connection to the model provider dropped mid-stream before anything from the step had executed. It then sends a `step-discard` event, and the SDK removes everything the interrupted step had streamed (its reasoning, text, and tool calls) before the retried step streams into the same place. Output committed by earlier steps is untouched. You do not need to handle this yourself: `messages` simply updates, and any part you were rendering from the abandoned step disappears in that update.

## Tool Call States

Tool calls progress through multiple states:

```tsx
import type { UIToolCallPart } from '@octavus/react';

function ToolCallPart({ part }: { part: UIToolCallPart }) {
  return (
    <div className="border rounded p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔧</span>
        <span className="font-medium">{part.displayName || part.toolName}</span>
        <StatusBadge status={part.status} />
      </div>

      {/* Show result when done */}
      {part.status === 'done' && part.result && (
        <pre className="mt-2 text-xs bg-gray-50 p-2 rounded">
          {JSON.stringify(part.result, null, 2)}
        </pre>
      )}

      {/* Show error if failed */}
      {part.status === 'error' && <p className="mt-2 text-red-500 text-sm">{part.error}</p>}

      {/* Show cancelled state */}
      {part.status === 'cancelled' && <p className="mt-2 text-amber-500 text-sm">Cancelled</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: UIToolCallPart['status'] }) {
  switch (status) {
    case 'pending':
      return <span className="text-gray-400">○</span>;
    case 'running':
      return <span className="text-blue-500 animate-spin">◐</span>;
    case 'done':
      return <span className="text-green-500">✓</span>;
    case 'error':
      return <span className="text-red-500">✗</span>;
    case 'cancelled':
      return <span className="text-amber-500">◼</span>;
  }
}
```

## Status Indicator

```tsx
function StatusIndicator({ status }: { status: ChatStatus }) {
  switch (status) {
    case 'idle':
      return null;
    case 'streaming':
      return <div>Agent is responding...</div>;
    case 'awaiting-input':
      return <div className="text-amber-500">Waiting for your input...</div>;
    case 'error':
      return <div className="text-red-500">Something went wrong</div>;
  }
}
```

## Handling Completion

```tsx
import { isRateLimitError, type OctavusError } from '@octavus/react';

useOctavusChat({
  transport,
  onFinish: () => {
    console.log('Stream completed successfully');
    // Scroll to bottom, play sound, etc.
  },
  onStop: () => {
    console.log('User stopped generation');
    // Handle stop - content is preserved
  },
  onError: (error: OctavusError) => {
    console.error('Stream error:', error.errorType, error.message);

    if (isRateLimitError(error)) {
      toast.error(`Rate limited. Retry in ${error.retryAfter}s`);
    } else {
      toast.error('Failed to get response');
    }
  },
});
```

See [Error Handling](/docs/client-sdk/error-handling) for comprehensive error handling patterns.

````

## Stop Function

Stop the current stream and finalize any partial message:

```tsx
const { status, stop } = useOctavusChat({ transport });

// Stop button
{status === 'streaming' && (
  <button onClick={stop} className="text-gray-500">
    Stop generating
  </button>
)}
````

When `stop()` is called:

1. The HTTP request is aborted (requires `signal` in transport)
2. Any partial text/reasoning is finalized with `done` status
3. In-progress tool calls are marked as `cancelled`
4. The `onStop` callback is invoked
5. Status changes to `idle`

Partial content is preserved in the message, so users don't lose what was already generated.

## Auto-Scroll

Chat interfaces should scroll to the bottom as new content streams in, but pause if the user has scrolled up to read earlier messages. The `useAutoScroll` hook handles this:

```tsx
import { useEffect } from 'react';
import { useOctavusChat, useAutoScroll, createHttpTransport } from '@octavus/react';

function Chat({ sessionId }: { sessionId: string }) {
  const transport = useMemo(/* ... */, [sessionId]);
  const { messages, status, send } = useOctavusChat({ transport });
  const {
    scrollRef,
    contentRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    scrollOnUpdate,
    resetAutoScroll,
  } = useAutoScroll();

  // Scroll to bottom when messages change (only if user hasn't scrolled up)
  useEffect(() => {
    const id = requestAnimationFrame(scrollOnUpdate);
    return () => cancelAnimationFrame(id);
  }, [messages, scrollOnUpdate]);

  const handleSend = async (text: string) => {
    resetAutoScroll(); // Force scroll on next update
    await send('user-message', { message: text }, { userMessage: { content: text } });
  };

  return (
    <div className="flex flex-col h-screen">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="flex-1 overflow-y-auto"
      >
        <div ref={contentRef}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <ChatInput onSend={handleSend} disabled={status === 'streaming'} />
    </div>
  );
}
```

The hook returns these values:

| Return Value       | Purpose                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `scrollRef`        | Attach to the scrollable container's `ref`                                                                                      |
| `contentRef`       | Attach to the element wrapping the messages - re-pins when content grows without a data update (e.g. an image finishes loading) |
| `handleScroll`     | Attach to the container's `onScroll` - tracks whether the user is near the bottom                                               |
| `handleWheel`      | Attach to the container's `onWheel` - pauses auto-scroll the instant the user wheels up                                         |
| `handleTouchStart` | Attach to the container's `onTouchStart` - baseline for touch drag detection                                                    |
| `handleTouchMove`  | Attach to the container's `onTouchMove` - pauses auto-scroll when the user drags up (touch)                                     |
| `scrollOnUpdate`   | Call inside a `useEffect` when messages change - scrolls to bottom if the user hasn't scrolled up                               |
| `resetAutoScroll`  | Call when the user sends a message - forces the next update to scroll to bottom                                                 |

Wiring `onWheel`/`onTouchStart`/`onTouchMove` makes the "pause on scroll up" reliable during fast streaming: a wheel or touch gesture is an unambiguous signal of user intent, so auto-scroll never fights the user or yanks them back to the bottom while a tool streams a long payload. The hook only treats a gesture as leaving the bottom when it actually scrolls the container - gestures consumed by a nested scrollable area (an expanded details panel, a code block) or by content rendered in a portal (a lightbox, a dialog) are ignored. Scroll-position changes produced by the browser itself - clamping when content above shrinks, or scroll anchoring while an image grows - never pause auto-scroll.

`contentRef` is optional but recommended: without it, content that changes height between data updates (images loading, panels expanding, fonts swapping) can leave the view stranded above the bottom until the next update.

You can customize the hook with options:

```tsx
const { scrollRef, handleScroll, scrollOnUpdate, resetAutoScroll } = useAutoScroll({
  threshold: 120, // Distance from bottom (px) to keep auto-scroll active (default: 80)
  scrollRef: myRef, // Bring your own ref if sharing the container with other logic
});
```

## Named Thread Content

Content from named threads (like "summary") streams separately and is identified by the `thread` property:

```tsx
import { isOtherThread, type UIMessage } from '@octavus/react';

function MessageBubble({ message }: { message: UIMessage }) {
  // Separate main thread from named threads
  const mainParts = message.parts.filter((p) => !isOtherThread(p));
  const otherParts = message.parts.filter((p) => isOtherThread(p));

  return (
    <div>
      {/* Main conversation */}
      {mainParts.map((part, i) => (
        <PartRenderer key={i} part={part} />
      ))}

      {/* Named thread content (e.g., summarization) */}
      {otherParts.length > 0 && (
        <div className="bg-amber-50 p-3 rounded mt-4 border border-amber-200">
          <div className="text-amber-600 font-medium mb-2">Background processing</div>
          {otherParts.map((part, i) => (
            <PartRenderer key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
}
```
