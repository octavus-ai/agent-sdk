---
title: API Reference
description: REST endpoints for the Workforce Agents API.
---

# Workforce Agents API

Drive a single agent over HTTP. Every request is authenticated with that agent's API key, sent as a bearer token:

```
Authorization: Bearer oct_agt_...
```

All endpoints are scoped to one agent through the `{agentId}` path segment - find the agent ID in the agent's page URL in the dashboard. A key only works for the agent it was created for.

## Get an agent

Read whether the agent can take a run now, what it is working on, and the state of its computer.

```
GET /api/v1/workforce/agents/{agentId}
```

### Response

```json
{
  "agentId": "cm5abc123def456ghi",
  "name": "Avery Stone",
  "status": "busy",
  "unavailableReason": null,
  "currentThreadId": "cm5xyz123abc456def",
  "queuedThreads": 0,
  "computer": { "kind": "dedicated", "os": "linux", "state": "running" },
  "definition": { "slug": "research-analyst", "version": 12 },
  "capabilities": { "memory": true, "credentials": false }
}
```

| Field               | Type           | Description                                                                                                                                           |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`            | string         | `idle` (ready for a run), `busy` (a run is in flight or queued), or `unavailable` (a new run cannot start - see `unavailableReason`)                  |
| `unavailableReason` | string \| null | `paused` (the owner paused the agent), `computer_down` (its computer cannot be reached), or `cli_only` (it runs only from the Agent CLI)              |
| `currentThreadId`   | string \| null | The thread holding the agent: the running one, else the oldest dispatched or queued one                                                               |
| `queuedThreads`     | number         | Threads waiting behind the current one                                                                                                                |
| `computer`          | object         | `kind` (`dedicated`, `e2b`, `daytona`, `mac`, or `cli`), `os` (`linux`, `windows`, or `macos`), and `state` (see below)                               |
| `definition`        | object \| null | The pre-built agent the agent was hired from (`slug`) and the version of its definition (`version`); null for an agent not hired from a pre-built one |
| `capabilities`      | object         | The capabilities the agent's definition declares, each with whether it is enabled                                                                     |

The computer `state` is `running`, `starting`, `paused` (stopped; it resumes on the next run), `down`, or `none` (no computer yet, or the caller's own machine for a CLI agent). The status is computed on every read, so it reflects a dispatch immediately. New values may be added to any of these fields; treat an unrecognized one as unknown.

### Example

```bash
curl https://octavus.ai/api/v1/workforce/agents/AGENT_ID \
  -H "Authorization: Bearer oct_agt_..."
```

## Start a thread

Dispatch a message to the agent. This starts a new thread and returns immediately.

```
POST /api/v1/workforce/agents/{agentId}/threads
```

### Request Body

```json
{
  "message": "Summarize the latest sales report"
}
```

| Field     | Type            | Required | Description                                                                                                                                  |
| --------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` | string          | Yes      | The task or message for the agent                                                                                                            |
| `files`   | FileReference[] | No       | Hosted file attachments                                                                                                                      |
| `config`  | RunConfig       | No       | Per-run configuration for this thread (see below). Omitted fields inherit the agent's stored settings.                                       |
| `ifIdle`  | boolean         | No       | Refuse instead of queuing when the agent already has a run in flight or queued (see [Only run on an idle agent](#only-run-on-an-idle-agent)) |

#### RunConfig

Configure how the agent runs for this thread without changing its dashboard settings - the same shape the [Agent CLI](/docs/workforce-agents/cli) accepts. Set on thread creation only; a thread's run config is fixed once it starts. The server validates and bounds it before the run starts, so an unrunnable model or an undeclared capability is rejected up front.

| Field              | Type                      | Description                                                                                             |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `model`            | string                    | Primary model for the run, `provider/model-id` (e.g. `anthropic/claude-sonnet-5`).                      |
| `backupModel`      | string                    | Backup model, `provider/model-id`.                                                                      |
| `thinking`         | string                    | Thinking/reasoning effort: `off`, `low`, `medium`, `high`, `max`, or `auto` (the model decides).        |
| `capabilities`     | Record\<string, boolean\> | Per-capability toggles (slug -> enabled). Unlisted capabilities inherit the agent default.              |
| `record`           | boolean                   | Record this run's execution view (working process + computer) to a shareable video.                     |
| `recordVisibility` | string                    | Where a recording is stored: `private` (default) or `public` (permanent URL). Ignored without `record`. |

Any model from the [model catalog](https://octavus.ai/pricing/models) is allowed, as long as a key resolves for its provider (your project/org key or the platform default), and so is any `openrouter/...` model when your project or org has its own OpenRouter key; any other model is rejected (see [Unsupported Models](/docs/protocol/agent-config#unsupported-models)). Capability toggles are bounded to the capabilities the agent's protocol declares.

### Response

Returns `201` (`200` when an [idempotency key](#retry-safely-with-an-idempotency-key) returns an earlier request's thread).

```json
{
  "threadId": "cm5xyz123abc456def",
  "status": "pending"
}
```

Poll the [Get a thread](#get-a-thread) endpoint until the status is terminal.

### Retry safely with an idempotency key

Send an `Idempotency-Key` header with a value unique to the task, such as a job id or a UUID (1-255 printable ASCII characters, no spaces):

```
Idempotency-Key: job-2026-03-04-reconcile-march
```

If you send the same key with the same request again - for example because the first response was lost - you get back `200` with the thread the first request created and an `Idempotent-Replayed: true` response header, and no second thread is started. The same key with a different request body is rejected with `409` `IDEMPOTENCY_KEY_REUSED`. A retry that arrives while the first request is still being processed can get `409` `IDEMPOTENCY_KEY_IN_PROGRESS` with a `Retry-After` header; retry after that delay to get the thread. A key stays bound to its thread for the thread's lifetime.

### Only run on an idle agent

An agent runs one task at a time, so a new thread normally waits behind a run already in flight (`queued`). With `"ifIdle": true` in the body, a dispatch to an agent that already has a run in flight or queued is refused with `409` `AGENT_BUSY` instead, and nothing is created:

```json
{
  "error": "The agent already has a run in flight or queued",
  "code": "AGENT_BUSY",
  "currentThreadId": "cm5xyz123abc456def"
}
```

`currentThreadId` names the thread holding the agent; it can be `null` when another dispatch is just starting. To check without dispatching, use [Get an agent](#get-an-agent). `ifIdle` looks at this agent's threads only: a Mac shared with other agents may be running one of theirs, in which case the new thread waits its turn on that computer.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/workforce/agents/AGENT_ID/threads \
  -H "Authorization: Bearer oct_agt_..." \
  -H "Content-Type: application/json" \
  -d '{ "message": "Summarize the latest sales report" }'
```

With a per-run config (model, thinking, capability toggles, recording):

```bash
curl -X POST https://octavus.ai/api/v1/workforce/agents/AGENT_ID/threads \
  -H "Authorization: Bearer oct_agt_..." \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Summarize the latest sales report",
    "config": {
      "model": "anthropic/claude-sonnet-5",
      "thinking": "high",
      "capabilities": { "memory": false },
      "record": true
    }
  }'
```

## Get a thread

Read a thread's status and messages. Poll this until the run finishes.

```
GET /api/v1/workforce/agents/{agentId}/threads/{threadId}
```

### Response

```json
{
  "threadId": "cm5xyz123abc456def",
  "status": "completed",
  "failureReason": null,
  "failureType": null,
  "messages": [],
  "runConfig": { "model": "anthropic/claude-sonnet-5", "thinking": "high" },
  "usage": {
    "currency": "USD",
    "costUsd": 0.0421,
    "totalFeeUsd": 0.0455,
    "byok": false,
    "inputTokens": 18234,
    "outputTokens": 1207,
    "totalTokens": 19441
  },
  "recording": null,
  "startedAt": "2026-03-04T10:12:03.418Z",
  "completedAt": "2026-03-04T10:19:47.902Z",
  "provenance": {
    "platform": {
      "deployments": [
        {
          "deploymentId": "dpl_9Xa2mQ7kLp3RtV8Wn",
          "commitSha": "4f1c2e9a7b3d5f60817c9e2a4b6d8f0a1c3e5b79",
          "firstSeenAt": "2026-03-04T10:12:03.912Z"
        }
      ]
    },
    "definition": { "slug": "research-analyst", "version": 12 },
    "computer": {
      "kind": "dedicated",
      "os": "linux",
      "runtimeVersion": "75",
      "imageVersion": "46",
      "region": "us-east-1"
    }
  }
}
```

| Field           | Type           | Description                                                                                                                                                                                                                                            |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `threadId`      | string         | The thread identifier                                                                                                                                                                                                                                  |
| `status`        | string         | `idle`, `queued`, `pending`, `running`, `completed`, `failed`, `cancelled`, or `blocked`                                                                                                                                                               |
| `failureReason` | string \| null | Why the run stopped, when `status` is `failed` or `blocked` (a usage/spending limit)                                                                                                                                                                   |
| `failureType`   | string \| null | The class of `failureReason` - see [Failure types](#failure-types). Null when there is no failure.                                                                                                                                                     |
| `messages`      | UIMessage[]    | The conversation - see [UIMessage parts](/docs/api-reference/sessions)                                                                                                                                                                                 |
| `runConfig`     | object \| null | The effective per-run config the thread ran under (`model`, `backupModel`, `thinking`, `capabilities`). Null for a run with no per-run config.                                                                                                         |
| `usage`         | object \| null | Per-run cost + token summary: `costUsd` (model/provider cost), `totalFeeUsd` (provider + bandwidth fee), `byok`, and input/output/total tokens.                                                                                                        |
| `recording`     | object \| null | The execution recording when the run was recorded: `status`, `visibility`, a playable `url` once ready, and `error`. Null when not recorded.                                                                                                           |
| `startedAt`     | string \| null | When the thread's first run started on the agent's computer (ISO 8601). Null while queued or pending, or when it never started.                                                                                                                        |
| `completedAt`   | string \| null | When the thread's latest run reached its terminal status (ISO 8601). Null while a run is in flight (a follow-up clears it). With `startedAt`, the thread's own duration - for a single-run thread, the run's - so there is no need to time your polls. |
| `provenance`    | object \| null | What the thread ran on, recorded while it ran - see [Provenance](#provenance). Null until a step of the thread has run (for example, a `blocked` thread).                                                                                              |

Keep polling while the status is `pending`, `queued`, or `running`. Stop when it is `completed`, `failed`, `cancelled`, or `blocked`. A `blocked` thread means a usage or spending limit was reached (see `failureReason`); the thread is created even when the run is blocked before it starts, so a blocked attempt is still a pollable thread rather than an error. If the run was recorded and you need the video, keep polling until the recording is final too (see [Recording](#recording)).

### Recording

A recorded run's `recording` has its own lifecycle, and it settles shortly after the run ends: a thread can read `completed` while its recording is still `processing`. To get the video, keep polling the thread until `recording.status` is `ready`, `failed`, or `unavailable`. It normally takes a few seconds.

| Status        | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `requested`   | Recording was requested, but the run has not started yet (for example, it is queued behind another run) |
| `recording`   | The run is being recorded                                                                               |
| `processing`  | The run has ended; the video is being finalized                                                         |
| `ready`       | Final. `url` plays the video                                                                            |
| `failed`      | Final. The video could not be produced; `error` says why                                                |
| `unavailable` | Final. The recording never started (for example, the plan does not include recording); `error` says why |

`recording` is `null` only when the run was not recorded.

### Provenance

`provenance` describes the run itself, not whatever is current when you read it, so a result can be attributed to exactly what produced it:

| Field                  | Type           | Description                                                                                                                                                                               |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.deployments` | object[]       | The platform builds that executed the thread's steps, oldest first: `deploymentId`, `commitSha`, and `firstSeenAt`. Usually one; more than one means a new build was deployed mid-thread. |
| `definition`           | object \| null | The pre-built agent the agent was hired from (`slug`) and the version of its definition (`version`), as of the thread's latest step. Null for an agent not hired from a pre-built one.    |
| `computer`             | object \| null | The computer, as of the thread's latest step: `kind`, `os`, `runtimeVersion`, `imageVersion`, and `region`. Null when no step reached a computer.                                         |

`computer.kind` is `dedicated`, `e2b`, `daytona`, `mac`, or `cli`. `runtimeVersion` is the computer's runtime release (the desktop app version on a Mac, the Agent CLI version for a CLI run), and `imageVersion` is the image a dedicated computer launched from or the sandbox template of an E2B or Daytona computer.

### Failure types

`failureType` classifies why a `failed` or `blocked` run stopped, so you can tell the agent failing at its task from a problem reaching it without parsing `failureReason`.

| Type                   | Meaning                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `computer_unreachable` | The agent's computer could not be reached, so the run never started                                         |
| `network`              | A connectivity failure on the way to the run: it could not be handed off, or its connection dropped mid-run |
| `transport`            | The run's connection to Octavus kept dropping and could not be recovered                                    |
| `platform`             | A failure on the Octavus side                                                                               |
| `provider`             | The model provider returned an error, was overloaded, or rate limited the run                               |
| `timeout`              | A request timed out, usually to the model provider                                                          |
| `billing`              | A plan allowance was reached; accompanies `blocked`                                                         |
| `limit`                | A spending limit was reached; accompanies `blocked`                                                         |
| `session_too_large`    | The thread can no longer be stored; continue in a new thread                                                |
| `unknown`              | The failure could not be classified                                                                         |

Only `computer_unreachable` guarantees the run never started. Every other type can follow work the agent already did, so check `messages` before retrying a task with side effects. New types may be added; treat an unrecognized value like `unknown`.

### Example

```bash
curl https://octavus.ai/api/v1/workforce/agents/AGENT_ID/threads/THREAD_ID \
  -H "Authorization: Bearer oct_agt_..."
```

## Follow up in a thread

Send another message into an existing thread. If the agent is still working the message runs after the current turn finishes; otherwise it starts immediately.

```
POST /api/v1/workforce/agents/{agentId}/threads/{threadId}/messages
```

### Request Body

```json
{
  "message": "Now turn that into a slide deck"
}
```

| Field     | Type            | Required | Description             |
| --------- | --------------- | -------- | ----------------------- |
| `message` | string          | Yes      | The follow-up message   |
| `files`   | FileReference[] | No       | Hosted file attachments |

### Response

Returns `202`.

```json
{
  "threadId": "cm5xyz123abc456def",
  "status": "running"
}
```

Poll [Get a thread](#get-a-thread) for the new run's result.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/workforce/agents/AGENT_ID/threads/THREAD_ID/messages \
  -H "Authorization: Bearer oct_agt_..." \
  -H "Content-Type: application/json" \
  -d '{ "message": "Now turn that into a slide deck" }'
```

## Cancel a thread's run

Stop a thread's in-flight run - the programmatic equivalent of the dashboard Stop button. The executor is signaled to abort, so a run that has overrun stops instead of continuing to bill. Idempotent: a thread that has already finished (or never started) is left as-is.

```
POST /api/v1/workforce/agents/{agentId}/threads/{threadId}/cancel
```

### Response

Returns `200`.

```json
{
  "threadId": "cm5xyz123abc456def",
  "status": "cancelled"
}
```

`status` is `cancelled` once the run was in flight, or the thread's unchanged status when it had already finished. The executor abort completes shortly after; poll [Get a thread](#get-a-thread) for the settled state.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/workforce/agents/AGENT_ID/threads/THREAD_ID/cancel \
  -H "Authorization: Bearer oct_agt_..."
```

## Errors

Errors return `{ "error": string, "code": string }` with an HTTP status:

| Status | Meaning                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | The request is invalid (for example a malformed body or `Idempotency-Key`)                                                                                                                                                                                       |
| `401`  | Missing or invalid API key                                                                                                                                                                                                                                       |
| `402`  | The agent is blocked by a usage or spending limit                                                                                                                                                                                                                |
| `403`  | The key is not authorized for this agent                                                                                                                                                                                                                         |
| `404`  | The thread does not exist for this agent                                                                                                                                                                                                                         |
| `409`  | `AGENT_BUSY` (an `ifIdle` dispatch to a busy agent), `IDEMPOTENCY_KEY_REUSED` (a key reused with a different request), `IDEMPOTENCY_KEY_IN_PROGRESS` (the key's first request is still being processed - retry shortly), or `AGENT_PAUSED` (the agent is paused) |
