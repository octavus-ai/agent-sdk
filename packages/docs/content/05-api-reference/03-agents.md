---
title: Agents
description: Agent management API endpoints.
---

# Agents API

Manage agent definitions including protocols and prompts.

## Permissions

| Endpoint               | Method | Permission Required |
| ---------------------- | ------ | ------------------- |
| `/api/agents`          | GET    | Agents OR Sessions  |
| `/api/agents/:id`      | GET    | Agents OR Sessions  |
| `/api/agents`          | POST   | Agents              |
| `/api/agents/:id`      | PATCH  | Agents              |
| `/api/agents/validate` | POST   | Agents              |

Read endpoints work with either permission since both the CLI (for sync) and Server SDK (for sessions) need to read agent definitions.

## List Agents

Get all agents in the project.

```
GET /api/agents
```

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
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### Example

```bash
curl https://octavus.ai/api/agents \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Get Agent

Get a single agent by ID.

```
GET /api/agents/:id
```

### Response

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
  ]
}
```

### Example

```bash
curl https://octavus.ai/api/agents/:agentId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

> **Tip:** You can also view and edit agents directly in the [platform](https://octavus.ai), or use the [CLI](/docs/server-sdk/cli) (`octavus list`) for local workflows.

## Create Agent

Create a new agent.

```
POST /api/agents
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
  ]
}
```

| Field                  | Type   | Required | Description               |
| ---------------------- | ------ | -------- | ------------------------- |
| `settings.slug`        | string | Yes      | URL-safe identifier       |
| `settings.name`        | string | Yes      | Display name              |
| `settings.description` | string | No       | Agent description         |
| `settings.format`      | string | Yes      | `interactive` or `worker` |
| `protocol`             | string | Yes      | YAML protocol definition  |
| `prompts`              | array  | Yes      | Prompt files              |

### Response

```json
{
  "agentId": "cm5xvz7k80001abcd",
  "message": "Agent created successfully"
}
```

### Example

```bash
curl -X POST https://octavus.ai/api/agents \
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

Update an existing agent.

```
PATCH /api/agents/:id
```

### Request Body

```json
{
  "protocol": "input:\n  COMPANY_NAME: { type: string }\n...",
  "prompts": [
    {
      "name": "system",
      "content": "Updated system prompt..."
    }
  ]
}
```

All fields are optional. Only provided fields are updated.

### Response

```json
{
  "agentId": "cm5xvz7k80001abcd",
  "message": "Agent updated successfully"
}
```

### Example

```bash
curl -X PATCH https://octavus.ai/api/agents/:agentId \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "agent:\n  model: anthropic/claude-sonnet-4-5\n  system: system\n  thinking: high"
  }'
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
