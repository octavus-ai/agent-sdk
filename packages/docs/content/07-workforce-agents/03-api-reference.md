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

| Field     | Type            | Required | Description                                                                                            |
| --------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `message` | string          | Yes      | The task or message for the agent                                                                      |
| `files`   | FileReference[] | No       | Hosted file attachments                                                                                |
| `config`  | RunConfig       | No       | Per-run configuration for this thread (see below). Omitted fields inherit the agent's stored settings. |

#### RunConfig

Configure how the agent runs for this thread without changing its dashboard settings - the same shape the [Agent CLI](/docs/workforce-agents/cli) accepts. Set on thread creation only; a thread's run config is fixed once it starts. The server validates and bounds it before the run starts, so an unrunnable model or an undeclared capability is rejected up front.

| Field              | Type                      | Description                                                                                             |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `model`            | string                    | Primary model for the run, `provider/model-id` (e.g. `anthropic/claude-sonnet-5`).                      |
| `backupModel`      | string                    | Backup model, `provider/model-id`.                                                                      |
| `thinking`         | string                    | Thinking/reasoning effort: `off`, `low`, `medium`, `high`, or `max`.                                    |
| `capabilities`     | Record\<string, boolean\> | Per-capability toggles (slug -> enabled). Unlisted capabilities inherit the agent default.              |
| `record`           | boolean                   | Record this run's execution view (working process + computer) to a shareable video.                     |
| `recordVisibility` | string                    | Where a recording is stored: `private` (default) or `public` (permanent URL). Ignored without `record`. |

Any model from the [model catalog](https://octavus.ai/pricing/models) is allowed, as is any OpenRouter or Vercel AI Gateway route, as long as a key resolves for its provider (your project/org key or the platform default); any other model is rejected (see [Unsupported Models](/docs/protocol/agent-config#unsupported-models)). Capability toggles are bounded to the capabilities the agent's protocol declares.

### Response

Returns `201`.

```json
{
  "threadId": "cm5xyz123abc456def",
  "status": "pending"
}
```

Poll the [Get a thread](#get-a-thread) endpoint until the status is terminal.

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
  "recording": null
}
```

| Field           | Type           | Description                                                                                                                                     |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadId`      | string         | The thread identifier                                                                                                                           |
| `status`        | string         | `idle`, `queued`, `pending`, `running`, `completed`, `failed`, `cancelled`, or `blocked`                                                        |
| `failureReason` | string \| null | Why the run stopped, when `status` is `failed` or `blocked` (a usage/spending limit)                                                            |
| `messages`      | UIMessage[]    | The conversation - see [UIMessage parts](/docs/api-reference/sessions)                                                                          |
| `runConfig`     | object \| null | The effective per-run config the thread ran under (`model`, `backupModel`, `thinking`, `capabilities`). Null for a run with no per-run config.  |
| `usage`         | object \| null | Per-run cost + token summary: `costUsd` (model/provider cost), `totalFeeUsd` (provider + bandwidth fee), `byok`, and input/output/total tokens. |
| `recording`     | object \| null | The execution recording when the run was recorded: `status`, `visibility`, a playable `url` once ready, and `error`. Null when not recorded.    |

Keep polling while the status is `pending`, `queued`, or `running`. Stop when it is `completed`, `failed`, `cancelled`, or `blocked`. A `blocked` thread means a usage or spending limit was reached (see `failureReason`); the thread is created even when the run is blocked before it starts, so a blocked attempt is still a pollable thread rather than an error.

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

| Status | Meaning                                           |
| ------ | ------------------------------------------------- |
| `401`  | Missing or invalid API key                        |
| `402`  | The agent is blocked by a usage or spending limit |
| `403`  | The key is not authorized for this agent          |
| `404`  | The thread does not exist for this agent          |
