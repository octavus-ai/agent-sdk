---
title: Overview
description: Introduction to the Octavus Server SDK for backend integration.
---

# Server SDK Overview

The `@octavus/server-sdk` package provides a Node.js SDK for integrating Octavus agents into your backend application. It handles session management, streaming, and the tool execution continuation loop.

**Current version:** `{{VERSION:@octavus/server-sdk}}`

## Installation

```bash
npm install @octavus/server-sdk
```

For agent management (sync, validate), install the CLI as a dev dependency:

```bash
npm install --save-dev @octavus/cli
```

## Basic Usage

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: 'your-api-key',
});
```

## Key Features

### Agent Management

Agent definitions are managed via the CLI. See the [CLI documentation](/docs/server-sdk/cli) for details.

```bash
# Sync agent from local files
octavus sync ./agents/support-chat

# Output: Created: support-chat
#         Agent ID: clxyz123abc456
```

### Session Management

Create and manage agent sessions using the agent ID:

```typescript
// Create a new session (use agent ID from CLI sync)
const sessionId = await client.agentSessions.create('clxyz123abc456', {
  COMPANY_NAME: 'Acme Corp',
  PRODUCT_NAME: 'Widget Pro',
});

// Get UI-ready session messages (for session restore)
const session = await client.agentSessions.getMessages(sessionId);
```

### Tool Handlers

Tools run on your server with your data:

```typescript
const session = client.agentSessions.attach(sessionId, {
  tools: {
    'get-user-account': async (args) => {
      // Access your database, APIs, etc.
      return await db.users.findById(args.userId);
    },
  },
});
```

### Streaming

All responses stream in real-time:

```typescript
import { toSSEStream } from '@octavus/server-sdk';

// execute() returns an async generator of events
const events = session.execute({
  type: 'trigger',
  triggerName: 'user-message',
  input: { USER_MESSAGE: 'Hello!' },
});

// Convert to SSE stream for HTTP responses
return new Response(toSSEStream(events), {
  headers: { 'Content-Type': 'text/event-stream' },
});
```

## API Reference

### OctavusClient

The main entry point for interacting with Octavus.

```typescript
interface OctavusClientConfig {
  baseUrl: string; // Octavus API URL
  apiKey?: string; // Your API key
}

class OctavusClient {
  readonly agents: AgentsApi;
  readonly agentSessions: AgentSessionsApi;
  readonly workers: WorkersApi;
  readonly files: FilesApi;

  constructor(config: OctavusClientConfig);
}
```

### AgentSessionsApi

Manages agent sessions.

```typescript
class AgentSessionsApi {
  // Create a new session
  async create(agentId: string, input?: Record<string, unknown>): Promise<string>;

  // Get full session state (for debugging/internal use)
  async get(sessionId: string): Promise<SessionState>;

  // Get UI-ready messages (for client display)
  async getMessages(sessionId: string): Promise<UISessionState>;

  // Attach to a session for triggering
  attach(sessionId: string, options?: SessionAttachOptions): AgentSession;
}

// Full session state (internal format)
interface SessionState {
  id: string;
  agentId: string;
  input: Record<string, unknown>;
  variables: Record<string, unknown>;
  resources: Record<string, unknown>;
  messages: ChatMessage[]; // Internal message format
  createdAt: string;
  updatedAt: string;
}

// UI-ready session state
interface UISessionState {
  sessionId: string;
  agentId: string;
  messages: UIMessage[]; // UI-ready messages for frontend
}
```

### AgentSession

Handles request execution and streaming for a specific session.

```typescript
class AgentSession {
  // Execute a request and stream parsed events
  execute(request: SessionRequest, options?: TriggerOptions): AsyncGenerator<StreamEvent>;

  // Get the session ID
  getSessionId(): string;
}

type SessionRequest = TriggerRequest | ContinueRequest;

interface TriggerRequest {
  type: 'trigger';
  triggerName: string;
  input?: Record<string, unknown>;
}

interface ContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}

// Helper to convert events to SSE stream
function toSSEStream(events: AsyncIterable<StreamEvent>): ReadableStream<Uint8Array>;
```

### FilesApi

Handles file uploads for sessions.

```typescript
class FilesApi {
  // Get presigned URLs for file uploads
  async getUploadUrls(sessionId: string, files: FileUploadRequest[]): Promise<UploadUrlsResponse>;
}

interface FileUploadRequest {
  filename: string;
  mediaType: string;
  size: number;
}

interface UploadUrlsResponse {
  files: {
    id: string; // File ID for references
    uploadUrl: string; // PUT to this URL
    downloadUrl: string; // GET URL after upload
  }[];
}
```

The client uploads files directly to S3 using the presigned upload URL. See [File Uploads](/docs/client-sdk/file-uploads) for the full integration pattern.

## Next Steps

- [Sessions](/docs/server-sdk/sessions) — Deep dive into session management
- [Tools](/docs/server-sdk/tools) — Implementing tool handlers
- [Streaming](/docs/server-sdk/streaming) — Understanding stream events
- [Workers](/docs/server-sdk/workers) — Executing worker agents
