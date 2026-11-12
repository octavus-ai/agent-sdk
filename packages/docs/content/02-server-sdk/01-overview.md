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
const { id: sessionId } = await client.sessions.create('clxyz123abc456', {
  COMPANY_NAME: 'Acme Corp',
  PRODUCT_NAME: 'Widget Pro',
});

// Get the conversation as UI-ready messages (for session restore)
const messages = await client.sessions.getMessages(sessionId);
```

### Tool Handlers

Tools run on your server with your data:

```typescript
const session = client.sessions.attach(sessionId, {
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

### Computer Capabilities

Give agents access to browser, filesystem, and shell via MCP:

```typescript
import { Computer } from '@octavus/computer';

const computer = new Computer({
  mcpServers: {
    browser: Computer.stdio('chrome-devtools-mcp', ['--browser-url=...']),
    filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', [dir]),
    shell: Computer.shell({ cwd: dir, mode: 'unrestricted' }),
  },
});

await computer.start();

const session = client.sessions.attach(sessionId, {
  tools: {
    'set-chat-title': async (args) => ({ title: args.title }),
  },
});

session.setDynamicTools(computer);
```

### Workers

Execute worker agents for task-based processing:

```typescript
// Non-streaming: get the output directly
const { output } = await client.workers.generate(agentId, {
  TOPIC: 'AI safety',
});

// Streaming: observe events in real-time
for await (const event of client.workers.execute(agentId, input)) {
  // Handle stream events
}
```

## API Reference

### OctavusClient

The main entry point for interacting with Octavus.

```typescript
interface OctavusClientConfig {
  baseUrl?: string; // The platform's URL (default: https://octavus.ai)
  apiKey?: string; // Your API key
  traceModelRequests?: boolean; // Enable model request tracing (default: false)
  maxRetries?: number; // Retries for transient network failures during streaming (default: 2, set to 0 to disable)
  headers?: Record<string, string>; // Extra headers sent on every request (the SDK's own take precedence)
}

class OctavusClient {
  readonly agents: AgentsApi;
  readonly sessions: SessionsApi;
  readonly workers: WorkersApi;
  readonly files: FilesApi;
  readonly skills: SkillsApi;
  readonly tokens: TokensApi;

  constructor(config?: OctavusClientConfig);
}
```

### SessionsApi

Manages sessions.

```typescript
class SessionsApi {
  // Create a session
  async create(agentId: string, input?: Record<string, unknown>): Promise<Session>;

  // Get a session (agent, creation time, active or expired)
  async get(sessionId: string): Promise<Session>;

  // Get the conversation as UI-ready messages (empty once the session expired)
  async getMessages(sessionId: string): Promise<UIMessage[]>;

  // Restore an expired session from stored messages
  async restoreFromMessages(
    sessionId: string,
    messages: UIMessage[],
    input?: Record<string, unknown>,
  ): Promise<Session>;

  // Clear the session's state; it becomes expired
  async clear(sessionId: string): Promise<Session>;

  // The execution log
  async getLogs(sessionId: string, options?: GetLogsOptions): Promise<ExecutionLogs>;

  // Attach to a session for triggering
  attach(sessionId: string, options?: SessionAttachOptions): AgentSession;

  // Create a session and run its first trigger in one request
  start(options: StartSessionOptions): AgentSession;
}

interface Session {
  id: string;
  agentId: string;
  status: 'active' | 'expired';
  createdAt: string;
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

  // Register dynamic tools (e.g., pass a Computer or explicit DynamicTool[])
  setDynamicTools(source: ToolProvider | DynamicTool[]): void;
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

Files are project resources: upload once, reference anywhere a protocol takes a `file`.

```typescript
class FilesApi {
  // Upload one file and get the FileReference to pass on
  async upload(
    data: Blob | Uint8Array | ArrayBuffer,
    meta: FileUploadMeta,
    options?: CreateFilesOptions,
  ): Promise<FileReference>;
  // Create files and get presigned upload + download URLs
  async create(
    files: FileUploadRequest[],
    options?: CreateFilesOptions,
  ): Promise<UploadUrlsResponse>;
  // Read a file with a fresh download URL
  async get(fileId: string): Promise<FileResource>;
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

The bytes go directly to storage through the presigned upload URL. See [Files](/docs/server-sdk/files) for the full API and [File Uploads](/docs/client-sdk/file-uploads) for the browser integration pattern.

## Next Steps

- [Sessions](/docs/server-sdk/sessions) - Deep dive into session management
- [Tools](/docs/server-sdk/tools) - Implementing tool handlers
- [Streaming](/docs/server-sdk/streaming) - Understanding stream events
- [Workers](/docs/server-sdk/workers) - Executing worker agents
- [Files](/docs/server-sdk/files) - Uploading files and referencing them
- [Debugging](/docs/server-sdk/debugging) - Model request tracing and debugging
- [Computer](/docs/server-sdk/computer) - Browser, filesystem, and shell via MCP
