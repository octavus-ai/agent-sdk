---
title: Using the SDK
description: Drive a Workforce Agent with the @octavus/server-sdk workforce client.
---

# Using the SDK

`@octavus/server-sdk` ships a `workforce` client for driving an agent with its per-agent key.

## Install

```bash
npm install @octavus/server-sdk@{{VERSION:@octavus/server-sdk}}
```

## Set up the client

Construct `OctavusClient` with your agent's API key:

```ts
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: process.env.OCTAVUS_AGENT_KEY, // oct_agt_...
});
```

## Run a task and wait for the result

`run()` is the all-in-one method: it dispatches a message, polls until the run finishes, and returns the completed thread.

```ts
const thread = await client.workforce.run(agentId, 'Summarize the latest sales report');

console.log(thread.status); // 'completed' | 'failed' | 'cancelled' | 'blocked'
console.log(thread.messages); // the full conversation, including the agent's reply
```

The agent's latest turn is at the end of `thread.messages`.

## Dispatch and poll manually

For more control, dispatch and read the thread yourself:

```ts
const { threadId } = await client.workforce.dispatch(agentId, 'Research our top 3 competitors');

const thread = await client.workforce.getThread(agentId, threadId);
if (thread.status === 'completed') {
  // ...
}
```

`waitForCompletion()` does the polling loop for you until the thread is terminal:

```ts
const { threadId } = await client.workforce.dispatch(agentId, 'Draft the Q3 board update');
const thread = await client.workforce.waitForCompletion(agentId, threadId);
```

## Follow up in the same thread

Continue a thread with another message. It runs after the current turn finishes.

```ts
await client.workforce.followUp(agentId, threadId, 'Now turn that into a slide deck');
const thread = await client.workforce.waitForCompletion(agentId, threadId);
```

## Cancel a run

Stop an in-flight run - the programmatic equivalent of the dashboard Stop button. Use it to enforce your own time or cost budget: cancel a run that has taken too long instead of letting it continue. It is idempotent, so a thread that has already finished is left unchanged.

```ts
await client.workforce.cancel(agentId, threadId);
const thread = await client.workforce.getThread(agentId, threadId); // status: 'cancelled'
```

## Configure a run

`dispatch()` and `run()` accept a `config` to set the model, backup model, thinking effort, capability toggles, and recording for the run - the same shape the [Agent CLI](/docs/workforce-agents/cli) accepts. Set it when starting a thread; a thread's run config is fixed at creation, so `followUp()` takes no config. Omitted fields inherit the agent's stored configuration, and the server validates it before the run starts (an unrunnable model or an undeclared capability is rejected up front).

```ts
const thread = await client.workforce.run(agentId, 'Summarize the latest sales report', {
  config: {
    model: 'anthropic/claude-sonnet-5',
    backupModel: 'openai/gpt-5.5',
    thinking: 'high',
    capabilities: { memory: false },
    record: true,
  },
});

console.log(thread.runConfig); // the effective config the run used
console.log(thread.usage?.costUsd, thread.usage?.totalTokens);
console.log(thread.recording?.url); // playable URL once the recording is ready
```

This makes the SDK a drop-in benchmark harness: sweep models or capability sets across runs and read `runConfig` + `usage` back off each thread to attribute the result.

## Options

`run()` and `waitForCompletion()` accept polling options. Full runs can take several minutes, so the defaults are generous.

| Option           | Type        | Default  | Description                                   |
| ---------------- | ----------- | -------- | --------------------------------------------- |
| `pollIntervalMs` | number      | `3000`   | Delay between status checks                   |
| `timeoutMs`      | number      | `900000` | Max time to wait before throwing (15 minutes) |
| `signal`         | AbortSignal | -        | Cancel the wait early                         |

`dispatch()`, `followUp()`, and `run()` also accept `files` (an array of `FileReference`) to attach hosted files to the message.

```ts
const thread = await client.workforce.run(agentId, 'Review this spec', {
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  pollIntervalMs: 5000,
});
```

If the timeout elapses first, `waitForCompletion()` and `run()` throw. The run keeps going on the server, so you can read it later with `getThread()`.

## Result shape

`getThread()`, `waitForCompletion()`, and `run()` return a thread:

| Field           | Type           | Description                                                                                                      |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `threadId`      | string         | The thread identifier                                                                                            |
| `status`        | string         | `idle`, `queued`, `pending`, `running`, `completed`, `failed`, `cancelled`, or `blocked`                         |
| `failureReason` | string \| null | Why the run stopped, when `status` is `failed` or `blocked` (a usage/spending limit)                             |
| `messages`      | UIMessage[]    | The conversation - text, tool and skill steps, and files (see [UIMessage parts](/docs/api-reference/sessions))   |
| `runConfig`     | object \| null | The effective per-run config the thread ran under (model, backupModel, thinking, capabilities); null if none     |
| `usage`         | object \| null | Per-run cost + token summary (`costUsd`, `totalFeeUsd`, `byok`, token counts); zeros until the run accrues spend |
| `recording`     | object \| null | The execution recording when recorded (`status`, `visibility`, `url`, `error`); null otherwise                   |

Use `isTerminalThreadStatus(status)` to check whether a run has finished.

The same operations are available as plain HTTP - see the [API reference](/docs/workforce-agents/api-reference).
