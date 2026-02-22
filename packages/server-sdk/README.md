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
  baseUrl: process.env.OCTAVUS_BASE_URL!,
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Create a session
const sessionId = await client.agentSessions.create(agentId, {
  COMPANY_NAME: 'Acme Corp',
});

// Attach to session with tool handlers
const session = client.agentSessions.attach(sessionId, {
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
  baseUrl: 'https://api.octavus.ai', // Or your self-hosted URL
  apiKey: 'your-api-key', // Optional: for authenticated requests
});
```

### Agent Sessions API

```typescript
// Create a new session
const sessionId = await client.agentSessions.create(agentId, input);

// Get session state (for debugging)
const state = await client.agentSessions.get(sessionId);

// Get UI-ready messages
const { messages, status } = await client.agentSessions.getMessages(sessionId);

// Restore expired session
await client.agentSessions.restore(sessionId, storedMessages, input);

// Clear session state (resets to expired)
await client.agentSessions.clear(sessionId);

// Attach to session for triggering
const session = client.agentSessions.attach(sessionId, options);
```

### Agents API

```typescript
// List all agents
const agents = await client.agents.list();

// Get agent by ID
const agent = await client.agents.get(agentId);
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
const session = client.agentSessions.attach(sessionId, {
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
const session = client.agentSessions.attach(sessionId, {
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

### Resource Handlers

Track resource updates from the agent:

```typescript
import { Resource } from '@octavus/server-sdk';

class ConversationSummaryResource extends Resource {
  readonly name = 'CONVERSATION_SUMMARY';

  async onUpdate(value: unknown) {
    // Persist to database, trigger webhooks, etc.
    await db.sessions.update(sessionId, { summary: value });
  }
}

const session = client.agentSessions.attach(sessionId, {
  resources: [new ConversationSummaryResource()],
});
```

### Abort Support

```typescript
const events = session.trigger('user-message', input, {
  signal: request.signal, // AbortSignal from request
});
```

## Session Lifecycle

### Active Sessions

Sessions remain active for 24 hours (configurable). Use `getMessages()` for UI display.

### Expired Sessions

When session state expires:

```typescript
const result = await client.agentSessions.getMessages(sessionId);

if (result.status === 'expired') {
  // Restore from your stored messages
  await client.agentSessions.restore(sessionId, storedMessages);
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
