---
title: Overview
description: REST API overview and authentication.
---

# API Reference

The Octavus API is a RESTful API that enables programmatic access to agent management and session execution.

## Base URL

```
https://octavus.ai/api/v1
```

Every endpoint lives under `/api/v1`. The path is the version: `v1` is extended additively, and a change that would break a client ships under a new prefix (see [Versioning](/docs/api-reference/versioning)).

## Authentication

Most API requests require authentication using a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://octavus.ai/api/v1/agents
```

The public [Models](/docs/api-reference/models) catalog is the exception - it needs no authentication.

API keys can be created in the Octavus Platform under your project's **API Keys** page.

For workloads that run in ephemeral or user-reachable environments (CI runners, serverless functions, per-user sandboxes), prefer a **short-lived, scoped credential** over a long-lived key - either an Octavus-minted ephemeral token or a federated workload-identity token you sign yourself. See [Authentication](/docs/authentication/overview).

## API Key Permissions

API keys have these permission scopes:

| Permission      | Description                                                           | Used By    |
| --------------- | --------------------------------------------------------------------- | ---------- |
| **Sessions**    | Create and manage sessions, trigger agents, run workers, upload files | Server SDK |
| **Agents**      | Create, update, and validate agent definitions                        | CLI        |
| **Skills**      | Upload skill bundles and set their secrets (organization keys)        | CLI        |
| **Mint Tokens** | Mint short-lived, scoped ephemeral credentials                        | Server SDK |

Both the Sessions and Agents permissions allow reading agent definitions (needed by CLI for sync and Server SDK for sessions).

**Recommended setup:** Use separate API keys for different purposes:

- **CLI key** with only "Agents" permission for CI/CD and development
- **Server key** with only "Sessions" permission for production applications

This limits the blast radius if a key is compromised.

## Response Format

All responses are JSON. A request that creates or changes a resource returns the resource (a session, an agent, a skill); a list returns `{ "<plural>": [...] }`. Nothing is wrapped in a `data` field.

### Success Response

```json
{
  "id": "sess_abc123",
  "agentId": "cm5xvz7k80001abcd",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### Error Response

Every error, on every endpoint, is one flat body:

```json
{
  "error": "Session not found: sess_abc123",
  "code": "NOT_FOUND",
  "type": "not_found_error",
  "retryable": false,
  "requestId": "req_8f2c41d07a9b4e6c"
}
```

| Field        | Description                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`      | A readable message                                                                                                                          |
| `code`       | The stable machine-readable code (`NOT_FOUND`, `VALIDATION_ERROR`, `INVALID_PROTOCOL`, `UNKNOWN_TOOL_CALL`, `AGENT_BUSY`, ...)              |
| `type`       | The classification, the same vocabulary as a stream `error` event's `errorType` (`validation_error`, `not_found_error`, `rate_limit_error`) |
| `retryable`  | Whether the same request can succeed if retried                                                                                             |
| `requestId`  | The request's ID, an opaque string; quote it when contacting support                                                                        |
| `issues`     | Present on a validation failure (`400`) or an invalid agent definition (`422`): the structured issues                                       |
| `retryAfter` | Present on a `429` or `503`: seconds to wait, also sent as the `Retry-After` header                                                         |

An endpoint may add fields that describe the error's data (a `409 AGENT_BUSY` names the thread holding the agent). Unknown fields are to be ignored.

### Request IDs

Every response, success or error, carries the request's ID in the `Request-Id` header. An `error` event the platform raises on a stream carries the same ID as `requestId`.

## HTTP Status Codes

| Code | Description                                                         |
| ---- | ------------------------------------------------------------------- |
| 200  | Success                                                             |
| 201  | Created                                                             |
| 400  | Bad Request - Invalid parameters (`issues` lists them)              |
| 401  | Unauthorized - Missing or invalid API key                           |
| 402  | Payment Required - A plan limit was reached                         |
| 403  | Forbidden - Insufficient permissions                                |
| 404  | Not Found                                                           |
| 409  | Conflict - The state does not allow the request (a busy agent)      |
| 422  | Unprocessable - The agent definition is invalid (`issues` says why) |
| 426  | Upgrade Required - This client version is no longer supported       |
| 429  | Too Many Requests - Honor `Retry-After`                             |
| 500  | Internal Server Error                                               |
| 503  | Service Unavailable - Honor `Retry-After`                           |

## Service Status

Current status, active incidents, planned maintenance, and incident history are on the [Octavus status page](https://www.octavus-status.com), where you can also subscribe to updates. It is hosted separately from the API, so it stays reachable during an outage.

## Endpoints Overview

### Sessions

| Method | Endpoint                                                | Description                                      |
| ------ | ------------------------------------------------------- | ------------------------------------------------ |
| POST   | `/api/v1/sessions`                                      | Create a session                                 |
| POST   | `/api/v1/sessions/start`                                | Create a session and run its first trigger (SSE) |
| GET    | `/api/v1/sessions/:id`                                  | Get a session (`active` or `expired`)            |
| DELETE | `/api/v1/sessions/:id`                                  | Clear a session's state                          |
| GET    | `/api/v1/sessions/:id/messages`                         | The conversation as UI messages                  |
| POST   | `/api/v1/sessions/:id/trigger`                          | Run a trigger (SSE)                              |
| POST   | `/api/v1/sessions/:id/executions/:executionId/continue` | Continue a paused execution (SSE)                |
| POST   | `/api/v1/sessions/:id/restore`                          | Restore an expired session from stored messages  |
| GET    | `/api/v1/sessions/:id/logs`                             | The execution log                                |
| POST   | `/api/v1/sessions/:id/uploads`                          | Presigned upload URLs for files                  |
| POST   | `/api/v1/sessions/:id/files/view-url`                   | A view URL for a file the session produced       |

### Agents

| Method | Endpoint                                              | Description                              |
| ------ | ----------------------------------------------------- | ---------------------------------------- |
| GET    | `/api/v1/agents`                                      | List agents (`?slug=` finds one)         |
| GET    | `/api/v1/agents/:id`                                  | Get an agent's definition                |
| POST   | `/api/v1/agents`                                      | Create an agent                          |
| PATCH  | `/api/v1/agents/:id`                                  | Update an agent                          |
| DELETE | `/api/v1/agents/:id`                                  | Archive an agent                         |
| POST   | `/api/v1/agents/validate`                             | Validate a definition without saving     |
| POST   | `/api/v1/agents/:id/executions`                       | Run a worker agent (SSE)                 |
| POST   | `/api/v1/agents/:id/executions/:executionId/continue` | Continue a paused worker execution (SSE) |

### Skills

| Method | Endpoint                     | Description                                        |
| ------ | ---------------------------- | -------------------------------------------------- |
| POST   | `/api/v1/skills`             | Upload a skill bundle (create or update the skill) |
| PUT    | `/api/v1/skills/:id/secrets` | Set a skill's secrets                              |

### Tokens

| Method | Endpoint                | Description                                |
| ------ | ----------------------- | ------------------------------------------ |
| POST   | `/api/v1/tokens`        | Mint a short-lived, scoped ephemeral token |
| POST   | `/api/v1/tokens/revoke` | Revoke a minted token before it expires    |

See [Authentication](/docs/authentication/overview) for scoping, lifetimes, and federation.

### Models

| Method | Endpoint         | Description                                       |
| ------ | ---------------- | ------------------------------------------------- |
| GET    | `/api/v1/models` | List usable models with pricing (public, no auth) |

### Workforce

The [Workforce API](/docs/workforce-agents/api-reference) (`/api/v1/workforce/...`) drives an Octavus Agent with a per-agent key.

## Streaming

The trigger endpoint returns Server-Sent Events (SSE):

```bash
curl -N -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"triggerName": "user-message", "input": {"USER_MESSAGE": "Hello"}}' \
  https://octavus.ai/api/v1/sessions/SESSION_ID/trigger
```

Response format:

```
data: {"type":"start","executionId":"...","sessionId":"...","messageId":"..."}

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
