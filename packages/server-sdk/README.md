# @octavus/server-sdk

Server SDK for integrating Octavus agents into your backend.

## Installation

```bash
npm install @octavus/server-sdk
```

## Overview

This package provides a server-side SDK for interacting with the Octavus platform. Use it to:

- Create and manage agent sessions
- Execute triggers with tool handling
- Stream responses to clients

## Quick Start

```typescript
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';

// Initialize client
const client = new OctavusClient({
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Create a session
const { id: sessionId } = await client.sessions.create(agentId, {
  COMPANY_NAME: 'Acme Corp',
});

// Attach to session with tool handlers
const session = client.sessions.attach(sessionId, {
  tools: {
    'get-user': async (args) => {
      return await db.users.findById(args.userId);
    },
    'create-ticket': async (args) => {
      return await ticketService.create(args);
    },
  },
});

// Trigger and stream response
const events = session.trigger('user-message', { USER_MESSAGE: 'Hello!' });
return new Response(toSSEStream(events), {
  headers: { 'Content-Type': 'text/event-stream' },
});
```

## OctavusClient

### Configuration

```typescript
const client = new OctavusClient({
  apiKey: 'your-api-key', // Optional: for authenticated requests
  baseUrl: 'https://octavus.ai', // Optional: the platform's URL (this is the default)
});
```

### Sessions API

```typescript
// Create a session: { id, agentId, status, createdAt }
const session = await client.sessions.create(agentId, input);

// Get a session (status is 'active' or 'expired')
const current = await client.sessions.get(session.id);

// Get the conversation as UI-ready messages
const messages = await client.sessions.getUiMessages(session.id);

// Restore an expired session from stored messages
await client.sessions.restoreFromUiMessages(session.id, storedMessages, input);

// Clear session state (the session becomes expired)
await client.sessions.clear(session.id);

// Attach to a session for triggering
const handle = client.sessions.attach(session.id, options);
```

### Agents API

```typescript
// List agents; `slug` narrows the list to one
const agents = await client.agents.list({ slug: 'support-chat' });

// Get an agent's definition by ID
const agent = await client.agents.get(agentId);

// Create, update, archive, and validate definitions (the Agents permission)
const created = await client.agents.create(definition);
const updated = await client.agents.update(agentId, { protocol });
const { valid, issues } = await client.agents.validate(definition);
await client.agents.archive(agentId);

// A definition the platform refuses fails with a 422 that carries its issues
try {
  await client.agents.update(agentId, { protocol });
} catch (error) {
  if (OctavusError.isInstance(error) && error.status === 422) {
    for (const issue of validationIssuesOf(error)) console.error(issue.severity, issue.message);
  }
}
```

### Skills API

```typescript
// Upload a skill bundle and set its secrets (an organization key with the Skills permission)
const { skill, created } = await client.skills.sync(bundleZip);
await client.skills.setSecrets(skill.id, { API_TOKEN: '...' });
```

### Files API

```typescript
// Get presigned upload URLs
const { files } = await client.files.getUploadUrls(sessionId, [
  { filename: 'photo.jpg', mediaType: 'image/jpeg', size: 102400 },
]);

// Upload directly to S3
await fetch(files[0].uploadUrl, {
  method: 'PUT',
  body: imageFile,
  headers: { 'Content-Type': 'image/jpeg' },
});

// Use downloadUrl in trigger input
await session.trigger('user-message', {
  FILES: [{ id: files[0].id, url: files[0].downloadUrl, mediaType: 'image/jpeg' }],
});
```

## AgentSession

### Triggering Events

```typescript
const session = client.sessions.attach(sessionId, {
  tools: {
    'tool-name': async (args) => {
      // Execute tool and return result
      return { success: true };
    },
  },
});

// Stream events (for WebSocket/Socket.io)
for await (const event of session.trigger('user-message', input)) {
  socket.emit('stream-event', event);
}

// Convert to SSE (for HTTP endpoints)
const events = session.trigger('user-message', input);
return new Response(toSSEStream(events), {
  headers: { 'Content-Type': 'text/event-stream' },
});
```

### Tool Handlers

The SDK automatically handles the tool execution loop:

1. Platform requests tool execution via `tool-request` event
2. SDK executes your tool handlers locally
3. SDK sends results back to continue the conversation

```typescript
const session = client.sessions.attach(sessionId, {
  tools: {
    'get-user-account': async (args) => {
      // Access your database, APIs, etc.
      return await db.users.findById(args.userId);
    },
    'create-support-ticket': async (args) => {
      // Execute with full access to your backend
      return await ticketService.create({
        summary: args.summary,
        priority: args.priority,
      });
    },
  },
});
```

### Persisting Agent State

A value the agent produces that your application keeps (a running summary, a generated title) is persisted through a tool handler: the protocol calls the tool from a `tool-call` block, and the handler writes the value wherever you store state.

```typescript
const session = client.sessions.attach(sessionId, {
  tools: {
    'save-conversation-summary': async (args) => {
      await db.sessions.update(sessionId, { summary: args.summary as string });
      return { saved: true };
    },
  },
});
```

### Errors

Every failed request throws an `OctavusError` - the same class the stream's `error` events become - with the HTTP `status`, the platform's stable `code`, the classification, whether a retry can help, and the `requestId` to quote to support.

```typescript
import { OctavusError } from '@octavus/server-sdk';

try {
  await client.sessions.getUiMessages(sessionId);
} catch (error) {
  if (OctavusError.isInstance(error) && error.status === 404) {
    // start a new session
  }
}
```

### Abort Support

```typescript
const events = session.trigger('user-message', input, {
  signal: request.signal, // AbortSignal from request
});
```

## Session Lifecycle

### Active Sessions

Sessions remain active for 24 hours (configurable). Use `getUiMessages()` for UI display, and store the messages to restore the session later.

### Expired Sessions

When session state expires:

```typescript
const session = await client.sessions.get(sessionId);

if (session.status === 'expired') {
  // Restore from your stored messages
  await client.sessions.restoreFromUiMessages(sessionId, storedMessages);
}
```

## Re-exports

This package re-exports everything from `@octavus/core`, so you don't need to install it separately.

## Related Packages

- [`@octavus/react`](https://www.npmjs.com/package/@octavus/react) - React hooks
- [`@octavus/client-sdk`](https://www.npmjs.com/package/@octavus/client-sdk) - Client-side SDK
- [`@octavus/cli`](https://www.npmjs.com/package/@octavus/cli) - CLI for agent management

## License

MIT
