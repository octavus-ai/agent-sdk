---
title: Triggers
description: Defining how agents are invoked.
---

# Triggers

Triggers define how an agent can be invoked. Each trigger has a name, optional inputs, and a corresponding handler.

## Trigger Types

### User Message

The most common trigger - when a user sends a chat message:

```yaml
triggers:
  user-message:
    description: User sends a chat message
    input:
      USER_MESSAGE:
        type: string
        description: The user's message
```

### User Action

For UI interactions like button clicks:

```yaml
triggers:
  request-human:
    description: User clicks "Talk to Human" button
    # No input needed - action is implicit

  submit-feedback:
    description: User submits feedback form
    input:
      RATING:
        type: number
        description: Rating from 1-5
      COMMENT:
        type: string
        description: Optional comment
        optional: true
```

### API Trigger

Direct invocation through the SDK:

```yaml
triggers:
  analyze-document:
    description: Analyze an uploaded document
    input:
      DOCUMENT_URL:
        type: string
      ANALYSIS_TYPE:
        type: string
        description: Type of analysis (summary, sentiment, extraction)
```

## Trigger Definition

```yaml
triggers:
  trigger-name:
    description: Optional description
    input:
      VARIABLE_NAME:
        type: string | number | integer | boolean | unknown | CustomType
        description: What this input is for
        optional: true | false # defaults to false
        default: value # default if optional and not provided
```

> **Tip**: You can use [custom types](/docs/protocol/types) for complex trigger inputs.

## Invoking Triggers

### From Client SDK

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

  // User message trigger with UI message
  await send('user-message', { USER_MESSAGE: text }, { userMessage: { content: text } });

  // User action trigger (no input, no UI message)
  await send('request-human');

  // Action with input
  await send('submit-feedback', { RATING: 5, COMMENT: 'Great help!' });
}
```

### From Server SDK

```typescript
// execute() returns an async generator of events
const events = session.execute({
  type: 'trigger',
  triggerName: 'user-message',
  input: { USER_MESSAGE: 'Help me with billing' },
});

// Iterate events directly
for await (const event of events) {
  console.log(event);
}

// Or convert to SSE for HTTP responses
import { toSSEStream } from '@octavus/server-sdk';
return new Response(toSSEStream(events), { headers: { 'Content-Type': 'text/event-stream' } });
```

## Handlers

Each trigger must have a corresponding handler:

```yaml
triggers:
  user-message:
    input:
      USER_MESSAGE: { type: string }

  request-human:
    description: Escalate to human support

handlers:
  user-message:
    # Blocks executed when user-message is triggered
    Add user message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]

    Respond:
      block: next-message

  request-human:
    # Blocks executed when request-human is triggered
    Summarize:
      block: serialize-thread
      # ...
```

## Trigger Input Naming

Trigger inputs use `UPPERCASE_SNAKE_CASE`:

```yaml
triggers:
  search-products:
    input:
      SEARCH_QUERY: { type: string }
      MAX_RESULTS: { type: number, optional: true, default: 10 }
      FILTER_CATEGORY: { type: string, optional: true }
```

## Best Practices

### 1. Use Descriptive Names

```yaml
# Good
triggers:
  user-message:       # Clear - user sends chat message
  request-human:      # Clear - wants human support
  cancel-subscription: # Clear - specific action

# Avoid
triggers:
  trigger1:           # Unclear
  msg:                # Too abbreviated
  do-thing:           # Vague
```

### 2. Document Triggers

```yaml
triggers:
  escalate-to-tier2:
    description: >
      Escalate the conversation to tier 2 support.
      Should be called when the issue cannot be resolved
      at tier 1 level.
    input:
      REASON:
        type: string
        description: Why escalation is needed
```

### 3. Keep Triggers Focused

Each trigger should do one thing:

```yaml
# Good - focused triggers
triggers:
  send-message:
    input: { MESSAGE: { type: string } }

  upload-file:
    input: { FILE_URL: { type: string } }

  request-callback:
    input: { PHONE: { type: string } }

# Avoid - overloaded trigger
triggers:
  user-action:
    input:
      ACTION_TYPE: { type: string }  # "message" | "file" | "callback"
      PAYLOAD: { type: unknown }     # Different structure per type
```
