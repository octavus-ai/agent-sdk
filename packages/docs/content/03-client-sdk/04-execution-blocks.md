---
title: Operations
description: Showing agent operations and progress with the Client SDK.
---

# Operations

Operations are the blocks of a handler that produce an artifact rather than a response: serializing a thread, generating an image, a video, or speech, transcribing audio. They appear as `operation` parts in messages and help users understand what the agent is doing.

## Operation Structure

```typescript
interface UIOperationPart {
  type: 'operation';
  operationId: string;
  name: string; // The block's name in the handler
  operationType: string; // The block type, e.g. 'serialize-thread', 'generate-image'
  title?: string; // The block's authored title, when it has one
  display?: 'hidden' | 'title' | 'stream';
  status: 'running' | 'done' | 'cancelled';
  thread?: string; // For named threads
}
```

## Rendering Operations

Operations are typically shown as compact status indicators. The label is the block's `title` when one was authored, else a label derived from its name - `getPartLabel()` applies that rule:

```tsx
import { getPartLabel, type UIOperationPart } from '@octavus/react';

function OperationCard({ operation }: { operation: UIOperationPart }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      {operation.status === 'running' ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      ) : (
        <span className="text-green-500">✓</span>
      )}
      <span>{getPartLabel(operation)}</span>
    </div>
  );
}
```

## Operations in Messages

Operations appear alongside text, reasoning, and tool calls in the message's `parts` array:

```tsx
import type { UIMessage, UIMessagePart } from '@octavus/react';

function MessageBubble({ message }: { message: UIMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => (
        <PartRenderer key={i} part={part} />
      ))}
    </div>
  );
}

function PartRenderer({ part }: { part: UIMessagePart }) {
  switch (part.type) {
    case 'text':
      return <TextPart part={part} />;
    case 'reasoning':
      return <ReasoningPart part={part} />;
    case 'tool-call':
      return <ToolCallCard part={part} />;
    case 'operation':
      return <OperationCard operation={part} />;
    default:
      return null;
  }
}
```

## Operation Types

| Type               | Description                        |
| ------------------ | ---------------------------------- |
| `serialize-thread` | Converting thread messages to text |
| `generate-image`   | Generating or editing an image     |
| `generate-video`   | Generating a video clip            |
| `generate-speech`  | Generating speech audio            |
| `transcribe-audio` | Transcribing audio to text         |

## Example: Progress During Escalation

When a user clicks "Talk to Human", multiple operations may occur:

```tsx
import { getPartLabel, type UIMessage, type UIOperationPart } from '@octavus/react';

function EscalationProgress({ message }: { message: UIMessage }) {
  const operations = message.parts.filter((p): p is UIOperationPart => p.type === 'operation');

  return (
    <div className="space-y-2">
      {operations.map((op) => (
        <div key={op.operationId} className="flex items-center gap-2 text-sm">
          {op.status === 'running' ? '⏳' : '✓'}
          <span>{getPartLabel(op)}</span>
        </div>
      ))}
    </div>
  );
}

// Example output during escalation:
// ✓ Summarizing the conversation
// ⏳ Generating the handoff report...
```

## Display Modes

An operation reaches the client only when its block has a visible display mode (`title` or `stream`); a `hidden` block emits nothing, live or in the stored conversation. The card shows the same label in both visible modes, so you can render every operation you receive without checking its mode.

## Named Thread Operations

Operations can belong to named threads. Use the `thread` property to identify them:

```tsx
function OperationCard({ operation }: { operation: UIOperationPart }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {operation.thread && <span className="text-amber-500">[{operation.thread}]</span>}
      <span>{getPartLabel(operation)}</span>
      {operation.status === 'done' && <span className="text-green-500">✓</span>}
    </div>
  );
}
```
