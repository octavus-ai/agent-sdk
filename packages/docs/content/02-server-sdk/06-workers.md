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

// Execute a worker
const events = client.workers.execute(agentId, {
  TOPIC: 'AI safety',
  DEPTH: 'detailed',
});

// Process events
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

## WorkersApi Reference

### execute()

Execute a worker and stream the response.

```typescript
async *execute(
  agentId: string,
  input: Record<string, unknown>,
  options?: WorkerExecuteOptions
): AsyncGenerator<StreamEvent>
```

**Parameters:**

| Parameter | Type                      | Description                 |
| --------- | ------------------------- | --------------------------- |
| `agentId` | `string`                  | The worker agent ID         |
| `input`   | `Record<string, unknown>` | Input values for the worker |
| `options` | `WorkerExecuteOptions`    | Optional configuration      |

**Options:**

```typescript
interface WorkerExecuteOptions {
  /** Tool handlers for server-side tool execution */
  tools?: ToolHandlers;
  /** Abort signal to cancel the execution */
  signal?: AbortSignal;
}
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

## Tool Handlers

Provide tool handlers to execute tools server-side:

```typescript
const events = client.workers.execute(
  agentId,
  { TOPIC: 'AI safety' },
  {
    tools: {
      'web-search': async (args) => {
        const results = await searchWeb(args.query);
        return results;
      },
      'get-user-data': async (args) => {
        return await db.users.findById(args.userId);
      },
    },
  },
);
```

Tools defined in the worker protocol but not provided as handlers become client tools — the execution pauses and emits a `client-tool-request` event.

## Stream Events

Workers emit standard stream events plus worker-specific events.

### Worker Events

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

### Common Events

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

## Extracting Output

To get just the worker's output value:

```typescript
async function executeWorker(
  client: OctavusClient,
  agentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const events = client.workers.execute(agentId, input);

  for await (const event of events) {
    if (event.type === 'worker-result') {
      if (event.error) {
        throw new Error(event.error);
      }
      return event.output;
    }
  }

  return undefined;
}

// Usage
const analysis = await executeWorker(client, agentId, { TOPIC: 'AI' });
```

## Client Tool Continuation

When workers have tools without handlers, execution pauses:

```typescript
for await (const event of client.workers.execute(agentId, input)) {
  if (event.type === 'client-tool-request') {
    // Execute tools client-side
    const results = await executeClientTools(event.toolCalls);

    // Continue execution
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

## Streaming to HTTP Response

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

## Cancellation

Use an abort signal to cancel execution:

```typescript
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30000);

const events = client.workers.execute(agentId, input, {
  signal: controller.signal,
});

try {
  for await (const event of events) {
    // Process events
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Worker cancelled');
  }
}
```

## Error Handling

Errors can occur at different levels:

```typescript
for await (const event of client.workers.execute(agentId, input)) {
  // Stream-level error event
  if (event.type === 'error') {
    console.error(`Error: ${event.message}`);
    console.error(`Type: ${event.errorType}`);
    console.error(`Retryable: ${event.retryable}`);
  }

  // Worker-level error in result
  if (event.type === 'worker-result' && event.error) {
    console.error(`Worker failed: ${event.error}`);
  }
}
```

Error types include:

| Type               | Description           |
| ------------------ | --------------------- |
| `validation_error` | Invalid input         |
| `not_found_error`  | Worker not found      |
| `provider_error`   | LLM provider error    |
| `tool_error`       | Tool execution failed |
| `execution_error`  | Worker step failed    |

## Full Example

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

// Run the worker
const result = await runResearchWorker('AI safety best practices');
console.log('Result:', result);
```

## Next Steps

- [Workers Protocol](/docs/protocol/workers) — Worker protocol reference
- [Streaming](/docs/server-sdk/streaming) — Understanding stream events
- [Tools](/docs/server-sdk/tools) — Tool handler patterns
