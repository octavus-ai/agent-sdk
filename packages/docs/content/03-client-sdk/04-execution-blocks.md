---
title: Operations
description: Showing agent operations and progress with the Client SDK.
---

# Operations

Operations represent internal agent activities like setting resources or serializing threads. They appear as `operation` parts in messages and help users understand what the agent is doing.

## Operation Structure

```typescript
interface UIOperationPart {
  type: 'operation';
  operationId: string;
  name: string; // Human-readable name
  operationType: string; // e.g., 'set-resource', 'serialize-thread'
  status: 'running' | 'done';
  thread?: string; // For named threads
}
```

## Rendering Operations

Operations are typically shown as compact status indicators:

```tsx
import type { UIOperationPart } from '@octavus/react';

function OperationCard({ operation }: { operation: UIOperationPart }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      {operation.status === 'running' ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      ) : (
        <span className="text-green-500">✓</span>
      )}
      <span>{operation.name}</span>
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

## Common Operation Types

| Type               | Description                        |
| ------------------ | ---------------------------------- |
| `set-resource`     | Updating a resource value          |
| `serialize-thread` | Converting thread messages to text |

## Example: Progress During Escalation

When a user clicks "Talk to Human", multiple operations may occur:

```tsx
function EscalationProgress({ message }: { message: UIMessage }) {
  const operations = message.parts.filter((p): p is UIOperationPart => p.type === 'operation');

  return (
    <div className="space-y-2">
      {operations.map((op) => (
        <div key={op.operationId} className="flex items-center gap-2 text-sm">
          {op.status === 'running' ? '⏳' : '✓'}
          <span>{op.name}</span>
        </div>
      ))}
    </div>
  );
}

// Example output during escalation:
// ✓ Serialize conversation
// ✓ Save conversation summary
// ⏳ Creating support ticket...
```

## Display Modes

Operations are only sent to the client if their protocol block has a visible display mode (`name`, `description`, or `stream`). Hidden operations (`display: hidden`) are filtered out by the platform before reaching the client.

This means you can safely render all operations without checking display mode - hidden ones won't be in the message parts.

## Named Thread Operations

Operations can belong to named threads. Use the `thread` property to identify them:

```tsx
function OperationCard({ operation }: { operation: UIOperationPart }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {operation.thread && <span className="text-amber-500">[{operation.thread}]</span>}
      <span>{operation.name}</span>
      {operation.status === 'done' && <span className="text-green-500">✓</span>}
    </div>
  );
}
```
