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

Most API requests require authentication using a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://octavus.ai/api/agents
```

The public [Models](/docs/api-reference/models) catalog is the exception - it needs no authentication.

API keys can be created in the Octavus Platform under your project's **API Keys** page.

For workloads that run in ephemeral or user-reachable environments (CI runners, serverless functions, per-user sandboxes), prefer a **short-lived, scoped credential** over a long-lived key - either an Octavus-minted ephemeral token or a federated workload-identity token you sign yourself. See [Authentication](/docs/authentication/overview).

## Wire-Format Versioning

The Server SDK advertises the wire shape it understands via the `X-Octavus-Sdk-Version` header (set automatically). The platform serves each caller the shape it advertised: what a newer version adds to a stream is sent only to callers that declared they handle it, and a request without the header gets the baseline. Direct API users send the header to opt into what a version carries.

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-Octavus-Sdk-Version: 5" \
  https://octavus.ai/api/agent-sessions/SESSION_ID
```

| Header value | Wire shape                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (missing)    | Baseline (v4) - the platform serves the v4 shape when no version is advertised.                                                                                                                                                           |
| `4`          | `step-start` parts in `UIMessage` / `ChatMessage`. A trigger or continuation runs until the execution pauses for tools or finishes.                                                                                                       |
| `5`          | Everything in v4, plus execution legs: a stream may end with `finish` and `finishReason: "continue"`, which the caller resumes with an empty continuation (see [Sessions - Execution Legs](/docs/api-reference/sessions#execution-legs)). |

The header value is the wire-format major the client can parse, not the SDK release version. A wire-incompatible change bumps it, and the platform keeps serving the previous shape to clients that still advertise the previous value.

## API Key Permissions

API keys have these permission scopes:

| Permission      | Description                                              | Used By    |
| --------------- | -------------------------------------------------------- | ---------- |
| **Sessions**    | Create and manage sessions, trigger agents, upload files | Server SDK |
| **Agents**      | Create, update, and validate agent definitions           | CLI        |
| **Mint Tokens** | Mint short-lived, scoped ephemeral credentials           | Server SDK |

Both the Sessions and Agents permissions allow reading agent definitions (needed by CLI for sync and Server SDK for sessions).

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
| 503  | Service Unavailable - Honor `Retry-After` |

## Service Status

Current status, active incidents, planned maintenance, and incident history are on the [Octavus status page](https://www.octavus-status.com), where you can also subscribe to updates. It is hosted separately from the API, so it stays reachable during an outage.

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

### Tokens

| Method | Endpoint             | Description                                |
| ------ | -------------------- | ------------------------------------------ |
| POST   | `/api/tokens`        | Mint a short-lived, scoped ephemeral token |
| POST   | `/api/tokens/revoke` | Revoke a minted token before it expires    |

See [Authentication](/docs/authentication/overview) for scoping, lifetimes, and federation.

### Models

| Method | Endpoint      | Description                                       |
| ------ | ------------- | ------------------------------------------------- |
| GET    | `/api/models` | List usable models with pricing (public, no auth) |

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
