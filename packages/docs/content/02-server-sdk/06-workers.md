---
title: Workers
description: Executing worker agents with the Server SDK.
---

# Workers API

The `WorkersApi` enables executing worker agents from your server. Workers are task-based agents that run steps sequentially and return an output value.

## Basic Usage

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: 'your-api-key',
});

const { output, sessionId } = await client.workers.generate(agentId, {
  TOPIC: 'AI safety',
  DEPTH: 'detailed',
});

console.log('Result:', output);
console.log(`Debug: ${client.baseUrl}/sessions/${sessionId}`);
```

## WorkersApi Reference

### generate()

Execute a worker and return the output directly.

```typescript
async generate(
  agentId: string,
  input: Record<string, unknown>,
  options?: WorkerExecuteOptions
): Promise<WorkerGenerateResult>
```

Runs the worker to completion and returns the output value. This is the simplest way to execute a worker.

**Returns:**

```typescript
interface WorkerGenerateResult {
  /** The worker's output value */
  output: unknown;
  /** Session ID for debugging (usable for session URLs) */
  sessionId: string;
}
```

**Throws:** `WorkerError` if the worker fails or completes without producing output.

### execute()

Execute a worker and stream the response. Use this when you need to observe intermediate events like text deltas, tool calls, or progress tracking.

```typescript
async *execute(
  agentId: string,
  input: Record<string, unknown>,
  options?: WorkerExecuteOptions
): AsyncGenerator<StreamEvent>
```

### continue()

Continue execution after client-side tool handling.

```typescript
async *continue(
  agentId: string,
  executionId: string,
  toolResults: ToolResult[],
  options?: WorkerExecuteOptions
): AsyncGenerator<StreamEvent>
```

Use this when the worker has tools without server-side handlers. The execution pauses with a `client-tool-request` event, you execute the tools, then call `continue()` to resume.

### Shared Options

All methods accept the same options:

```typescript
interface WorkerExecuteOptions {
  /** Tool handlers for server-side tool execution */
  tools?: ToolHandlers;
  /** Abort signal to cancel the execution */
  signal?: AbortSignal;
  /** Dynamic tool schemas (e.g., from MCP servers — browser, filesystem, shell) */
  dynamicToolSchemas?: ToolSchema[];
}
```

**Parameters:**

| Parameter | Type                      | Description                 |
| --------- | ------------------------- | --------------------------- |
| `agentId` | `string`                  | The worker agent ID         |
| `input`   | `Record<string, unknown>` | Input values for the worker |
| `options` | `WorkerExecuteOptions`    | Optional configuration      |

The `dynamicToolSchemas` option enables MCP tool support for workers executed via the SDK. Pass tool schemas from `@octavus/computer` (or any `ToolProvider`) so the worker can use MCP tools like browser, filesystem, and shell. Schemas are sent on the first request and cached for continuation rounds.

## Tool Handlers

Provide tool handlers to execute tools server-side:

```typescript
const { output } = await client.workers.generate(
  agentId,
  { TOPIC: 'AI safety' },
  {
    tools: {
      'web-search': async (args) => {
        return await searchWeb(args.query);
      },
      'get-user-data': async (args) => {
        return await db.users.findById(args.userId);
      },
    },
  },
);
```

Tools defined in the worker protocol but not provided as handlers become client tools — the execution pauses and emits a `client-tool-request` event.

## Error Handling

### WorkerError (generate)

`generate()` throws a `WorkerError` on failure. The error includes an optional `sessionId` for constructing debug URLs:

```typescript
import { OctavusClient, WorkerError } from '@octavus/server-sdk';

try {
  const { output } = await client.workers.generate(agentId, input);
  console.log('Result:', output);
} catch (error) {
  if (error instanceof WorkerError) {
    console.error('Worker failed:', error.message);
    if (error.sessionId) {
      console.error(`Debug: ${client.baseUrl}/sessions/${error.sessionId}`);
    }
  }
}
```

### Stream Errors (execute)

When using `execute()`, errors appear as stream events:

```typescript
for await (const event of client.workers.execute(agentId, input)) {
  if (event.type === 'error') {
    console.error(`Error: ${event.message}`);
    console.error(`Type: ${event.errorType}`);
    console.error(`Retryable: ${event.retryable}`);
  }

  if (event.type === 'worker-result' && event.error) {
    console.error(`Worker failed: ${event.error}`);
  }
}
```

### Error Types

| Type               | Description           |
| ------------------ | --------------------- |
| `validation_error` | Invalid input         |
| `not_found_error`  | Worker not found      |
| `provider_error`   | LLM provider error    |
| `tool_error`       | Tool execution failed |
| `execution_error`  | Worker step failed    |

## Cancellation

Use an abort signal to cancel execution:

```typescript
const { output } = await client.workers.generate(agentId, input, {
  signal: AbortSignal.timeout(30_000),
});
```

With `execute()` and a manual controller:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 30000);

try {
  for await (const event of client.workers.execute(agentId, input, {
    signal: controller.signal,
  })) {
    // Process events
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Worker cancelled');
  }
}
```

## Streaming

When you need real-time visibility into the worker's execution — text generation, tool calls, or progress — use `execute()` instead of `generate()`.

### Basic Streaming

```typescript
const events = client.workers.execute(agentId, {
  TOPIC: 'AI safety',
  DEPTH: 'detailed',
});

for await (const event of events) {
  if (event.type === 'worker-start') {
    console.log(`Worker ${event.workerSlug} started`);
  }
  if (event.type === 'text-delta') {
    process.stdout.write(event.delta);
  }
  if (event.type === 'worker-result') {
    console.log('Output:', event.output);
  }
}
```

### Streaming to HTTP Response

Convert worker events to an SSE stream:

```typescript
import { toSSEStream } from '@octavus/server-sdk';

export async function POST(request: Request) {
  const { agentId, input } = await request.json();

  const events = client.workers.execute(agentId, input, {
    tools: {
      search: async (args) => await search(args.query),
    },
  });

  return new Response(toSSEStream(events), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
```

### Client Tool Continuation

When workers have tools without handlers, execution pauses:

```typescript
for await (const event of client.workers.execute(agentId, input)) {
  if (event.type === 'client-tool-request') {
    const results = await executeClientTools(event.toolCalls);

    for await (const ev of client.workers.continue(agentId, event.executionId, results)) {
      // Handle remaining events
    }
    break;
  }
}
```

The `client-tool-request` event includes:

```typescript
{
  type: 'client-tool-request',
  executionId: string,      // Pass to continue()
  toolCalls: [{
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  }],
}
```

### Stream Events

Workers emit standard stream events plus worker-specific events.

#### Worker Events

```typescript
// Worker started
{
  type: 'worker-start',
  workerId: string,     // Unique ID (also used as session ID for debug)
  workerSlug: string,   // The worker's slug
  description?: string, // Display description for UI
}

// Worker completed
{
  type: 'worker-result',
  workerId: string,
  output?: unknown,  // The worker's output value
  error?: string,    // Error message if worker failed
}
```

#### Common Events

| Event                   | Description                 |
| ----------------------- | --------------------------- |
| `start`                 | Execution started           |
| `finish`                | Execution completed         |
| `text-start`            | Text generation started     |
| `text-delta`            | Text chunk received         |
| `text-end`              | Text generation ended       |
| `block-start`           | Step started                |
| `block-end`             | Step completed              |
| `tool-input-available`  | Tool arguments ready        |
| `tool-output-available` | Tool result ready           |
| `client-tool-request`   | Client tools need execution |
| `error`                 | Error occurred              |

## Full Examples

### generate()

```typescript
import { OctavusClient, WorkerError } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: process.env.OCTAVUS_API_KEY!,
});

try {
  const { output, sessionId } = await client.workers.generate(
    'research-assistant-id',
    {
      TOPIC: 'AI safety best practices',
      DEPTH: 'detailed',
    },
    {
      tools: {
        'web-search': async ({ query }) => await performWebSearch(query),
      },
      signal: AbortSignal.timeout(120_000),
    },
  );

  console.log('Result:', output);
} catch (error) {
  if (error instanceof WorkerError) {
    console.error('Failed:', error.message);
    if (error.sessionId) {
      console.error(`Debug: ${client.baseUrl}/sessions/${error.sessionId}`);
    }
  }
}
```

### execute()

For full control over streaming events and progress tracking:

```typescript
import { OctavusClient, type StreamEvent } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: process.env.OCTAVUS_API_KEY!,
});

async function runResearchWorker(topic: string) {
  console.log(`Researching: ${topic}\n`);

  const events = client.workers.execute(
    'research-assistant-id',
    {
      TOPIC: topic,
      DEPTH: 'detailed',
    },
    {
      tools: {
        'web-search': async ({ query }) => {
          console.log(`Searching: ${query}`);
          return await performWebSearch(query);
        },
      },
    },
  );

  let output: unknown;

  for await (const event of events) {
    switch (event.type) {
      case 'worker-start':
        console.log(`Started: ${event.workerSlug}`);
        break;

      case 'block-start':
        console.log(`Step: ${event.blockName}`);
        break;

      case 'text-delta':
        process.stdout.write(event.delta);
        break;

      case 'worker-result':
        if (event.error) {
          throw new Error(event.error);
        }
        output = event.output;
        break;

      case 'error':
        throw new Error(event.message);
    }
  }

  console.log('\n\nResearch complete!');
  return output;
}

const result = await runResearchWorker('AI safety best practices');
console.log('Result:', result);
```

## Next Steps

- [Workers Protocol](/docs/protocol/workers) — Worker protocol reference
- [Streaming](/docs/server-sdk/streaming) — Understanding stream events
- [Tools](/docs/server-sdk/tools) — Tool handler patterns
