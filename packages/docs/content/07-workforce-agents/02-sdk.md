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
console.log(thread.recording?.url); // playable URL - run() waits (bounded) for the recording to settle
```

A recording settles a few seconds after its run ends, so `run()` and `waitForCompletion()` keep polling a recorded run until its recording is final (`ready`, `failed`, or `unavailable`), up to `recordingTimeoutMs`. See [Recording](/docs/workforce-agents/api-reference#recording) for the statuses.

This makes the SDK a drop-in benchmark harness: sweep models or capability sets across runs and read `runConfig`, `usage`, and `provenance` back off each thread to attribute the result.

## Know what a run ran on

Each thread's `provenance` is recorded while it runs, so it describes the run itself rather than whatever is current when you read it:

```ts
const thread = await client.workforce.getThread(agentId, threadId);

console.log(thread.provenance?.platform.deployments); // the platform builds that executed the thread
console.log(thread.provenance?.definition); // { slug, version } of the agent's definition
console.log(thread.provenance?.computer); // { kind, os, runtimeVersion, imageVersion, region }
```

`platform.deployments` usually holds one build; more than one means a new build was deployed while the thread was running. `provenance` is `null` until a step of the thread has run, for example on a `blocked` thread.

## Retry a dispatch safely

Pass an `idempotencyKey` unique to the task, such as a job id. If a dispatch's response is lost and you dispatch again with the same key and the same request, you get back the thread the first request created instead of starting a second run:

```ts
const { threadId } = await client.workforce.dispatch(agentId, 'Reconcile the March invoices', {
  idempotencyKey: job.id,
});
```

Reusing a key with a different request fails with an `ApiError` whose `code` is `IDEMPOTENCY_KEY_REUSED`. A retry that arrives while the first request is still being processed can fail with `IDEMPOTENCY_KEY_IN_PROGRESS`; retry after a moment to get the thread. `run()` accepts `idempotencyKey` too.

## Only run on an idle agent

`getAgent()` tells you whether the agent can take a run now, what it is working on, and the state of its computer:

```ts
const agent = await client.workforce.getAgent(agentId);

console.log(agent.status); // 'idle' | 'busy' | 'unavailable'
console.log(agent.currentThreadId); // the thread holding the agent, when busy
console.log(agent.computer.state); // 'running' | 'starting' | 'paused' | 'down' | 'none'
```

An agent runs one task at a time, so a dispatch normally queues behind a run already in flight. With `ifIdle: true` the dispatch refuses instead, and nothing is created:

```ts
import { ApiError } from '@octavus/server-sdk';

try {
  await client.workforce.dispatch(agentId, 'Run the nightly audit', { ifIdle: true });
} catch (error) {
  if (error instanceof ApiError && error.code === 'AGENT_BUSY') {
    console.log('Busy with thread', error.details?.currentThreadId);
  }
}
```

## Options

`run()` and `waitForCompletion()` accept polling options. Full runs can take several minutes, so the defaults are generous.

| Option               | Type        | Default  | Description                                                                                                                            |
| -------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pollIntervalMs`     | number      | `3000`   | Delay between status checks                                                                                                            |
| `timeoutMs`          | number      | `900000` | Max time to wait before throwing (15 minutes)                                                                                          |
| `recordingTimeoutMs` | number      | `120000` | After the run finishes, how long to wait for a recorded run's recording to settle; it is returned as-is after that. `0` skips the wait |
| `signal`             | AbortSignal | -        | Cancel the wait early                                                                                                                  |

`dispatch()`, `followUp()`, and `run()` also accept `files` (an array of `FileReference`) to attach hosted files to the message, and `dispatch()` and `run()` accept `idempotencyKey` and `ifIdle` (see above).

```ts
const thread = await client.workforce.run(agentId, 'Review this spec', {
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  pollIntervalMs: 5000,
});
```

If the timeout elapses first, `waitForCompletion()` and `run()` throw. The run keeps going on the server, so you can read it later with `getThread()`.

## Result shape

`getThread()`, `waitForCompletion()`, and `run()` return a thread:

| Field           | Type           | Description                                                                                                                                                                                   |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadId`      | string         | The thread identifier                                                                                                                                                                         |
| `status`        | string         | `idle`, `queued`, `pending`, `running`, `completed`, `failed`, `cancelled`, or `blocked`                                                                                                      |
| `failureReason` | string \| null | Why the run stopped, when `status` is `failed` or `blocked` (a usage/spending limit)                                                                                                          |
| `failureType`   | string \| null | The class of `failureReason` (`WorkforceFailureType`); only `computer_unreachable` guarantees the run never started - see [Failure types](/docs/workforce-agents/api-reference#failure-types) |
| `messages`      | UIMessage[]    | The conversation - text, tool and skill steps, and files (see [UIMessage parts](/docs/api-reference/sessions))                                                                                |
| `runConfig`     | object \| null | The effective per-run config the thread ran under (model, backupModel, thinking, capabilities); null if none                                                                                  |
| `usage`         | object \| null | Per-run cost + token summary (`costUsd`, `totalFeeUsd`, `byok`, token counts); zeros until the run accrues spend                                                                              |
| `recording`     | object \| null | The execution recording when recorded (`status`, `visibility`, `url`, `error`); null otherwise                                                                                                |
| `startedAt`     | string \| null | When the thread's first run started on the agent's computer (ISO 8601); null while queued or pending, or when it never started                                                                |
| `completedAt`   | string \| null | When the thread's latest run reached its terminal status (ISO 8601); null while a run is in flight (a follow-up clears it). With `startedAt`, the thread's own duration                       |
| `provenance`    | object \| null | What the thread ran on (`platform.deployments`, `definition`, `computer`, `preparation`) - see [Know what a run ran on](#know-what-a-run-ran-on); null until a step has run                   |

Use `isTerminalThreadStatus(status)` to check whether a run has finished, and `isSettledRecordingStatus(status)` to check whether a recording is final.

The same operations are available as plain HTTP - see the [API reference](/docs/workforce-agents/api-reference).
