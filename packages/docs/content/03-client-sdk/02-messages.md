---
title: Messages
description: Working with message state in the Client SDK.
---

# Messages

Messages represent the conversation history. The Client SDK tracks messages automatically and provides structured access to their content through typed parts.

## Message Structure

```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];
  status: 'streaming' | 'done';
  createdAt: Date;
}
```

### Message Parts

Messages contain ordered `parts` that preserve content ordering:

```typescript
type UIMessagePart =
  | UITextPart
  | UIReasoningPart
  | UIToolCallPart
  | UIOperationPart
  | UISourcePart
  | UIFilePart
  | UIObjectPart
  | UITodoPart
  | UIWorkerPart;

// Text content
interface UITextPart {
  type: 'text';
  text: string;
  status: 'streaming' | 'done';
  thread?: string; // For named threads (e.g., "summary")
}

// Extended reasoning/thinking
interface UIReasoningPart {
  type: 'reasoning';
  text: string;
  status: 'streaming' | 'done';
  thread?: string;
}

// Tool execution
interface UIToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  displayName?: string; // Human-readable name
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  thread?: string;
}

// Internal operations (set-resource, serialize-thread)
interface UIOperationPart {
  type: 'operation';
  operationId: string;
  name: string;
  operationType: string;
  status: 'running' | 'done';
  thread?: string;
}

// Source references (from web search, document processing)
interface UISourcePart {
  type: 'source';
  sourceType: 'url' | 'document';
  id: string;
  url?: string; // For URL sources
  title?: string;
  mediaType?: string; // For document sources
  filename?: string;
  thread?: string;
}

// Generated files (from image generation, skills, code execution)
interface UIFilePart {
  type: 'file';
  id: string;
  mediaType: string; // MIME type (e.g., 'image/png', 'image/webp')
  url: string; // Download/display URL (presigned S3 URL)
  filename?: string;
  size?: number;
  toolCallId?: string; // Present if from a tool call
  thread?: string;
}

// Structured output (when responseType is used)
interface UIObjectPart {
  type: 'object';
  id: string;
  typeName: string; // Type name from protocol (e.g., "ChatResponse")
  partial?: unknown; // Partial object while streaming
  object?: unknown; // Final object when done
  status: 'streaming' | 'done' | 'error';
  error?: string;
  thread?: string;
}

// Structured task list (when the agent uses octavus_todo_write)
interface UITodoPart {
  type: 'todo';
  todos: {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  }[];
  status: 'streaming' | 'done';
  thread?: string;
}

// Sub-agent execution container (when an agent invokes a worker)
interface UIWorkerPart {
  type: 'worker';
  workerId: string;
  workerSlug: string;
  description?: string;
  input?: Record<string, unknown>;
  parts: UIMessagePart[]; // Nested parts from the worker (excluding nested workers)
  output?: unknown;
  error?: string;
  status: 'running' | 'done' | 'error';
}
```

## Sending Messages

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

  const { send } = useOctavusChat({ transport });

  async function handleSend(text: string) {
    // Add user message to UI and trigger agent
    await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });
  }

  // ...
}
```

The `send` function:

1. Adds the user message to the UI immediately (if `userMessage` is provided)
2. Triggers the agent with the specified trigger name and input
3. Streams the assistant's response back

### Message Content Types

The `content` field in `userMessage` accepts both strings and objects:

```tsx
// Text content → creates a text part
await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });

// Object content → creates an object part (uses `type` field as typeName)
const selection = { type: 'product_selection', productId: 'abc123', action: 'select' };
await send('user-message', { USER_INPUT: selection }, { userMessage: { content: selection } });
```

When passing an object as `content`:

- The SDK creates a `UIObjectPart` instead of a `UITextPart`
- The object's `type` field is used as the `typeName` (defaults to `'object'` if not present)
- This is useful for rich UI interactions like product selections, quick replies, etc.

### Sending with Files

Include file attachments with messages:

```tsx
import type { FileReference } from '@octavus/react';

async function handleSend(text: string, files?: FileReference[]) {
  await send(
    'user-message',
    {
      USER_MESSAGE: text,
      FILES: files, // Array of FileReference
    },
    {
      userMessage: {
        content: text,
        files: files, // Shows files in user message bubble
      },
    },
  );
}
```

See [File Uploads](/docs/client-sdk/file-uploads) for complete upload flow.

## Rendering Messages

### Basic Rendering

```tsx
function MessageList({ messages }: { messages: UIMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={isUser ? 'text-right' : 'text-left'}>
      <div className="inline-block p-3 rounded-lg">
        {message.parts.map((part, i) => (
          <PartRenderer key={i} part={part} />
        ))}
      </div>
    </div>
  );
}
```

### Rendering Parts

```tsx
import { isOtherThread, type UIMessagePart } from '@octavus/react';

function PartRenderer({ part }: { part: UIMessagePart }) {
  // Check if part belongs to a named thread (e.g., "summary")
  if (isOtherThread(part)) {
    return <OtherThreadPart part={part} />;
  }

  switch (part.type) {
    case 'text':
      return <TextPart part={part} />;

    case 'reasoning':
      return (
        <details className="text-gray-500">
          <summary>Thinking...</summary>
          <pre className="text-sm">{part.text}</pre>
        </details>
      );

    case 'tool-call':
      return (
        <div className="bg-gray-100 p-2 rounded text-sm">
          🔧 {part.displayName || part.toolName}
          {part.status === 'done' && ' ✓'}
          {part.status === 'error' && ` ✗ ${part.error}`}
        </div>
      );

    case 'operation':
      return (
        <div className="text-gray-500 text-sm">
          {part.name}
          {part.status === 'done' && ' ✓'}
        </div>
      );

    case 'source':
      return (
        <div className="text-blue-500 text-sm">📎 {part.title || part.url || part.filename}</div>
      );

    case 'file':
      // Render images inline, other files as download links
      if (part.mediaType.startsWith('image/')) {
        return (
          <img
            src={part.url}
            alt={part.filename || 'Generated image'}
            className="max-w-full rounded-lg"
          />
        );
      }
      return (
        <a href={part.url} className="text-blue-500 text-sm underline">
          📄 {part.filename || 'Download file'}
        </a>
      );

    case 'object':
      // For structured output, render custom UI based on typeName
      // See Structured Output guide for more details
      return <ObjectPartRenderer part={part} />;

    default:
      return null;
  }
}

function TextPart({ part }: { part: UITextPart }) {
  return (
    <p>
      {part.text}
      {part.status === 'streaming' && (
        <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
      )}
    </p>
  );
}
```

## Named Threads

Content from named threads (like "summary") is identified by the `thread` property. Use the `isOtherThread` helper:

```tsx
import { isOtherThread } from '@octavus/react';

function PartRenderer({ part }: { part: UIMessagePart }) {
  if (isOtherThread(part)) {
    // Render differently for named threads
    return (
      <div className="bg-amber-50 p-2 rounded border border-amber-200">
        <span className="text-amber-600 text-sm">
          {part.thread}: {part.type === 'text' && part.text}
        </span>
      </div>
    );
  }

  // Regular rendering for main thread
  // ...
}
```

## Session Restore

When restoring a session, fetch messages from your backend and pass them to the hook:

```tsx
import { useMemo } from 'react';
import { useOctavusChat, createHttpTransport, type UIMessage } from '@octavus/react';

interface ChatProps {
  sessionId: string;
  initialMessages: UIMessage[];
}

function Chat({ sessionId, initialMessages }: ChatProps) {
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

  // Pass existing messages to restore the conversation
  const { messages } = useOctavusChat({
    transport,
    initialMessages,
  });

  // ...
}
```

On your backend, use `agentSessions.getMessages()` to fetch UI-ready messages:

```typescript
// Server-side
const session = await client.agentSessions.getMessages(sessionId);
// session.messages is UIMessage[] ready for the client
```

## Callbacks

```tsx
useOctavusChat({
  transport,
  onFinish: () => {
    console.log('Stream completed');
    // Scroll to bottom, play sound, etc.
  },
  onError: (error) => {
    console.error('Error:', error);
    toast.error('Failed to get response');
  },
  onResourceUpdate: (name, value) => {
    console.log('Resource updated:', name, value);
  },
});
```
