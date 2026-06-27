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

| Field     | Type            | Required | Description                       |
| --------- | --------------- | -------- | --------------------------------- |
| `message` | string          | Yes      | The task or message for the agent |
| `files`   | FileReference[] | No       | Hosted file attachments           |

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
  "messages": []
}
```

| Field           | Type           | Description                                                                   |
| --------------- | -------------- | ----------------------------------------------------------------------------- |
| `threadId`      | string         | The thread identifier                                                         |
| `status`        | string         | `idle`, `queued`, `pending`, `running`, `completed`, `failed`, or `cancelled` |
| `failureReason` | string \| null | Why the run failed, when `status` is `failed`                                 |
| `messages`      | UIMessage[]    | The conversation - see [UIMessage parts](/docs/api-reference/sessions)        |

Keep polling while the status is `pending`, `queued`, or `running`. Stop when it is `completed`, `failed`, or `cancelled`.

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

## Errors

Errors return `{ "error": string, "code": string }` with an HTTP status:

| Status | Meaning                                           |
| ------ | ------------------------------------------------- |
| `401`  | Missing or invalid API key                        |
| `402`  | The agent is blocked by a usage or spending limit |
| `403`  | The key is not authorized for this agent          |
| `404`  | The thread does not exist for this agent          |
