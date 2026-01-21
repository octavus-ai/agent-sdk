---
title: Overview
description: REST API overview and authentication.
---

# API Reference

The Octavus API is a RESTful API that enables programmatic access to agent management and session execution.

## Base URL

```
https://octavus.ai
```

## Authentication

All API requests require authentication using a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://octavus.ai/api/agents
```

API keys can be created in the Octavus Platform under your project's **API Keys** page.

## API Key Permissions

API keys have two permission scopes:

| Permission   | Description                                              | Used By    |
| ------------ | -------------------------------------------------------- | ---------- |
| **Sessions** | Create and manage sessions, trigger agents, upload files | Server SDK |
| **Agents**   | Create, update, and validate agent definitions           | CLI        |

Both permissions allow reading agent definitions (needed by CLI for sync and Server SDK for sessions).

**Recommended setup:** Use separate API keys for different purposes:

- **CLI key** with only "Agents" permission for CI/CD and development
- **Server key** with only "Sessions" permission for production applications

This limits the blast radius if a key is compromised.

## Response Format

All responses are JSON. Success responses return the data directly (not wrapped in a `data` field).

### Success Response

```json
{
  "sessionId": "sess_abc123"
}
```

### Error Response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Agent not found"
  }
}
```

## HTTP Status Codes

| Code | Description                               |
| ---- | ----------------------------------------- |
| 200  | Success                                   |
| 201  | Created                                   |
| 400  | Bad Request - Invalid parameters          |
| 401  | Unauthorized - Missing or invalid API key |
| 403  | Forbidden - Insufficient permissions      |
| 404  | Not Found                                 |
| 500  | Internal Server Error                     |

## Endpoints Overview

### Agents

| Method | Endpoint          | Description     |
| ------ | ----------------- | --------------- |
| GET    | `/api/agents`     | List all agents |
| GET    | `/api/agents/:id` | Get agent by ID |
| POST   | `/api/agents`     | Create agent    |
| PATCH  | `/api/agents/:id` | Update agent    |

### Sessions

| Method | Endpoint                          | Description           |
| ------ | --------------------------------- | --------------------- |
| POST   | `/api/agent-sessions`             | Create session        |
| GET    | `/api/agent-sessions/:id`         | Get session state     |
| POST   | `/api/agent-sessions/:id/trigger` | Execute trigger (SSE) |

## Streaming

The trigger endpoint returns Server-Sent Events (SSE):

```bash
curl -N -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"triggerName": "user-message", "input": {"USER_MESSAGE": "Hello"}}' \
  https://octavus.ai/api/agent-sessions/SESSION_ID/trigger
```

Response format:

```
data: {"type":"start","messageId":"..."}

data: {"type":"block-start","blockId":"...","blockName":"Respond","blockType":"next-message","display":"stream"}

data: {"type":"text-start","id":"..."}

data: {"type":"text-delta","id":"...","delta":"Hello"}

data: {"type":"text-delta","id":"...","delta":"!"}

data: {"type":"text-end","id":"..."}

data: {"type":"block-end","blockId":"..."}

data: {"type":"finish","finishReason":"stop"}

data: [DONE]
```

## SDKs

We recommend using our SDKs instead of calling the API directly:

- **Server SDK**: `@octavus/server-sdk` - For Node.js backends
- **React SDK**: `@octavus/react` - For React applications
- **Client SDK**: `@octavus/client-sdk` - For other frontend frameworks

The SDKs handle authentication, streaming, and tool execution automatically.
