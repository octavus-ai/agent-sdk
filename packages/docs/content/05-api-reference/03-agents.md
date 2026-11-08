---
title: Agents
description: Agent management API endpoints.
---

# Agents API

Manage agent definitions including protocols, prompts, and references, and run worker agents.

Agents are addressed by their `id`. A slug is a filter on the list, never a path identifier: resolve one with [`GET /api/v1/agents?slug=`](#list-agents).

## Permissions

| Endpoint                                              | Method | Permission Required |
| ----------------------------------------------------- | ------ | ------------------- |
| `/api/v1/agents`                                      | GET    | Agents OR Sessions  |
| `/api/v1/agents/:id`                                  | GET    | Agents OR Sessions  |
| `/api/v1/agents`                                      | POST   | Agents              |
| `/api/v1/agents/:id`                                  | PATCH  | Agents              |
| `/api/v1/agents/:id`                                  | DELETE | Agents              |
| `/api/v1/agents/validate`                             | POST   | Agents              |
| `/api/v1/agents/:id/executions`                       | POST   | Sessions            |
| `/api/v1/agents/:id/executions/:executionId/continue` | POST   | Sessions            |

Read endpoints work with either permission since both the CLI (for sync) and Server SDK (for sessions) need to read agent definitions.

## The agent resource

Every endpoint that reads, creates, or changes an agent returns its definition:

```json
{
  "id": "cm5xvz7k80001abcd",
  "settings": {
    "slug": "support-chat",
    "name": "Support Chat",
    "description": "Customer support agent",
    "format": "interactive"
  },
  "protocol": "input:\n  COMPANY_NAME: { type: string }\n...",
  "prompts": [
    {
      "name": "system",
      "content": "You are a support agent for {{COMPANY_NAME}}..."
    },
    {
      "name": "user-message",
      "content": "{{USER_MESSAGE}}"
    }
  ],
  "references": [
    {
      "name": "api-guidelines",
      "description": "API design guidelines and conventions",
      "content": "# API Guidelines\n\nUse lowercase with dashes..."
    }
  ]
}
```

## List Agents

Get the project's agents, newest first.

```
GET /api/v1/agents
GET /api/v1/agents?slug=support-chat
```

### Query Parameters

| Parameter | Type   | Description                                                          |
| --------- | ------ | -------------------------------------------------------------------- |
| `slug`    | string | Optional. Only the agent with this slug - how a slug becomes an `id` |

### Response

```json
{
  "agents": [
    {
      "id": "cm5xvz7k80001abcd",
      "slug": "support-chat",
      "name": "Support Chat",
      "description": "Customer support agent",
      "format": "interactive",
      "createdAt": "2024-01-10T08:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z",
      "projectId": "cm5xvz7k80000proj"
    }
  ]
}
```

### Example

```bash
curl https://octavus.ai/api/v1/agents \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Get Agent

Get an agent's definition by ID.

```
GET /api/v1/agents/:id
```

### Response

The [agent](#the-agent-resource).

### Example

```bash
curl https://octavus.ai/api/v1/agents/:agentId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

> **Tip:** You can also view and edit agents directly in the [platform](https://octavus.ai), or use the [CLI](/docs/server-sdk/cli) (`octavus list`) for local workflows.

## Validate Agent

Validate an agent definition without saving it (a dry run). Mirrors `octavus validate` and the web editor's checks - use it in CI or before a create/update. Requires the Agents permission.

```
POST /api/v1/agents/validate
```

### Request Body

The same shape as [Create Agent](#create-agent) (`settings`, `protocol`, `prompts`, optional `references`).

### Response

```json
{
  "valid": true,
  "issues": [
    {
      "message": "Tool \"send-email\" will show its name; add a user-facing `title` for a cleaner label.",
      "path": "tools.send-email",
      "severity": "info",
      "code": "MISSING_DISPLAY_TITLE",
      "suggestions": ["Add a `title` to Tool \"send-email\""]
    }
  ]
}
```

| Field    | Type    | Description                                                                                                                |
| -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `valid`  | boolean | `true` when no issue is an error. Warnings and info never affect `valid`.                                                  |
| `issues` | array   | Every diagnostic at its severity (`error` / `warning` / `info`) with a machine-readable `code` and optional `suggestions`. |

Filter the issues by `code` to act on them programmatically: the retired display values are `DISPLAY_MODE_REMOVED`, removed protocol fields `REMOVED_FIELD`, a missing skill `UNDEFINED_SKILL`.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/agents/validate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": { "slug": "my-agent", "name": "My Agent", "format": "interactive" },
    "protocol": "agent:\n  model: anthropic/claude-sonnet-4-5\n  system: system",
    "prompts": [{ "name": "system", "content": "You are a helpful assistant." }]
  }'
```

## Create Agent

Create a new agent. The definition is validated as a whole - schema, semantic rules, and the existence of the skills, workers, MCP servers, and models it references - and an invalid one is refused with `422` and its [issues](#validate-agent).

```
POST /api/v1/agents
```

### Request Body

```json
{
  "settings": {
    "slug": "support-chat",
    "name": "Support Chat",
    "description": "Customer support agent",
    "format": "interactive"
  },
  "protocol": "input:\n  COMPANY_NAME: { type: string }\n...",
  "prompts": [
    {
      "name": "system",
      "content": "You are a support agent..."
    }
  ],
  "references": [
    {
      "name": "api-guidelines",
      "description": "API design guidelines and conventions",
      "content": "# API Guidelines\n..."
    }
  ]
}
```

| Field                  | Type   | Required | Description                                      |
| ---------------------- | ------ | -------- | ------------------------------------------------ |
| `settings.slug`        | string | Yes      | URL-safe identifier                              |
| `settings.name`        | string | Yes      | Display name                                     |
| `settings.description` | string | No       | Agent description                                |
| `settings.format`      | string | Yes      | `interactive` or `worker`                        |
| `protocol`             | string | Yes      | YAML protocol definition                         |
| `prompts`              | array  | Yes      | Prompt files                                     |
| `references`           | array  | No       | Reference documents (name, description, content) |

### Response

`201` with the [agent](#the-agent-resource). `409` with the code `CONFLICT` when an agent with the slug already exists in the project.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/agents \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "slug": "my-agent",
      "name": "My Agent",
      "format": "interactive"
    },
    "protocol": "agent:\n  model: anthropic/claude-sonnet-4-5\n  system: system",
    "prompts": [
      { "name": "system", "content": "You are a helpful assistant." }
    ]
  }'
```

## Update Agent

Update an existing agent. All fields are optional; what is left out keeps its current value. The definition the update produces is validated as fully as a create, so an update can never deploy an agent a create would refuse: an invalid one is `422` with its issues, and nothing is saved. The slug is the agent's identity and is not updated here.

```
PATCH /api/v1/agents/:id
```

### Request Body

```json
{
  "settings": {
    "name": "Support Chat",
    "description": "Customer support agent",
    "format": "interactive"
  },
  "protocol": "input:\n  COMPANY_NAME: { type: string }\n...",
  "prompts": [
    {
      "name": "system",
      "content": "Updated system prompt..."
    }
  ],
  "references": [
    {
      "name": "api-guidelines",
      "description": "Updated description",
      "content": "Updated content..."
    }
  ]
}
```

### Response

The updated [agent](#the-agent-resource).

### Example

```bash
curl -X PATCH https://octavus.ai/api/v1/agents/:agentId \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "agent:\n  model: anthropic/claude-sonnet-4-5\n  system: system\n  thinking: high"
  }'
```

## Archive Agent

Archive an agent (soft delete). The agent is removed from the active agent list and its slug is freed for reuse. Session history is preserved.

```
DELETE /api/v1/agents/:id
```

### Response

The [agent](#the-agent-resource) as it was before archiving.

### Example

```bash
curl -X DELETE https://octavus.ai/api/v1/agents/:agentId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Run Worker

Run a worker agent and stream the execution. Worker agents execute their steps sequentially and return an output value; unlike interactive sessions they keep no conversation, only the state of an execution paused for tools. Requires the Sessions permission.

```
POST /api/v1/agents/:id/executions
```

### Request Body

```json
{
  "input": { "TOPIC": "AI safety" }
}
```

| Field                | Type   | Required | Description                                                                                 |
| -------------------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `input`              | object | Yes      | The worker's input, validated against its protocol's `input`                                |
| `dynamicToolSchemas` | array  | No       | Schemas of tools the caller discovered at runtime, offered to the worker for this execution |

### Response

The same `text/event-stream` as a [session trigger](/docs/api-reference/sessions#trigger-session). The `start` event names the execution; a `worker-result` event carries the output before `finish`, and a `usage` event the execution's cost and tokens. An execution that pauses for tools ends with `tool-request` and `finish: tool-calls`; one that reaches its time budget ends with `finish: continue`. Either is resumed with [Continue Worker Execution](#continue-worker-execution).

## Continue Worker Execution

Continue a paused worker execution: deliver the results of the tools you ran, or resume a leg that reached its time budget. The rules are those of a [session continuation](/docs/api-reference/sessions#continue-execution): results are routed by the recorded call, an unknown call is `400 UNKNOWN_TOOL_CALL`, a partial submission re-states the calls still open, an empty body resumes a yielded leg, and an execution that is not resumable is `409 EXECUTION_NOT_RESUMABLE`.

```
POST /api/v1/agents/:id/executions/:executionId/continue
```

### Request Body

```json
{
  "toolResults": [{ "toolCallId": "tc_123", "result": { "found": true } }]
}
```

## Creating and Managing Agents

There are two ways to manage agents:

### Platform UI

Create and edit agents directly at [octavus.ai](https://octavus.ai). The web editor provides real-time validation and is the easiest way to get started. Copy the agent ID from the URL to use in your application.

### CLI (Local Development)

For version-controlled agent definitions, use the [Octavus CLI](/docs/server-sdk/cli):

```bash
octavus sync ./agents/support-chat
```

This creates the agent if it doesn't exist, or updates it if it does. The CLI outputs the agent ID which you should store in an environment variable.

For CI/CD integration, see the [CLI documentation](/docs/server-sdk/cli#cicd-integration).
