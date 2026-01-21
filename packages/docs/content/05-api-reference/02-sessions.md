---
title: Sessions
description: Session management API endpoints.
---

# Sessions API

Sessions represent conversations with agents. They store conversation history, resources, and variables.

All session endpoints require an API key with the **Sessions** permission.

## Create Session

Create a new agent session.

```
POST /api/agent-sessions
```

### Request Body

```json
{
  "agentId": "cm5xvz7k80001abcd",
  "input": {
    "COMPANY_NAME": "Acme Corp",
    "PRODUCT_NAME": "Widget Pro",
    "USER_ID": "user-123"
  }
}
```

| Field     | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| `agentId` | string | Yes      | Agent ID (the `id` field, not `slug`) |
| `input`   | object | No       | Input variables for the agent         |

> **Getting the agent ID:** Copy the ID from the agent URL in the [platform](https://octavus.ai) (e.g., `octavus.ai/agents/clxyz123`), or use the [CLI](/docs/server-sdk/cli) (`octavus sync ./agents/my-agent`) for local development workflows.

### Response

```json
{
  "sessionId": "cm5xyz123abc456def"
}
```

### Example

```bash
curl -X POST https://octavus.ai/api/agent-sessions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "cm5xvz7k80001abcd",
    "input": {
      "COMPANY_NAME": "Acme Corp",
      "PRODUCT_NAME": "Widget Pro"
    }
  }'
```

## Get Session

Retrieve session state. Returns UI-ready messages for active sessions, or expiration info for expired sessions.

```
GET /api/agent-sessions/:sessionId
```

### Query Parameters

| Parameter | Type   | Description                                          |
| --------- | ------ | ---------------------------------------------------- |
| `format`  | string | Optional. Use `format=ui` for UI-ready messages only |

### Response (Active Session)

When the session is active, the response includes `UIMessage` objects:

```json
{
  "id": "cm5xyz123abc456def",
  "agentId": "cm5xvz7k80001abcd",
  "status": "active",
  "input": {
    "COMPANY_NAME": "Acme Corp",
    "PRODUCT_NAME": "Widget Pro"
  },
  "variables": {},
  "resources": {
    "CONVERSATION_SUMMARY": ""
  },
  "messages": [
    {
      "id": "1702345800000-xyz789a",
      "role": "user",
      "parts": [{ "type": "text", "text": "How do I reset my password?", "status": "done" }],
      "status": "done",
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "1702345805000-def456b",
      "role": "assistant",
      "parts": [
        { "type": "text", "text": "I can help you reset your password...", "status": "done" }
      ],
      "status": "done",
      "createdAt": "2024-01-15T10:30:05.000Z"
    }
  ],
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:05Z"
}
```

### Response (Expired Session)

When the session has expired, the response indicates the expiration status:

```json
{
  "status": "expired",
  "sessionId": "cm5xyz123abc456def",
  "agentId": "cm5xvz7k80001abcd",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

Use the [Restore Session](#restore-session) endpoint to restore an expired session from stored messages.

````

### UIMessage Parts

Messages contain typed `parts` that preserve content ordering:

| Part Type | Description |
|-----------|-------------|
| `text` | Text content with `text` and `status` fields |
| `reasoning` | Extended reasoning with `text` and `status` fields |
| `tool-call` | Tool execution with `toolCallId`, `toolName`, `displayName`, `args`, `result`, `status` |
| `operation` | Internal operations with `operationId`, `name`, `operationType`, `status` |
| `file` | File attachment with `id`, `mediaType`, `url`, `filename`, `size` |
| `source` | Source reference with `sourceType`, `id`, `url`, `title` |
| `object` | Structured output with `id`, `typeName`, `object`, `status` |

### Example

```bash
curl https://octavus.ai/api/agent-sessions/:sessionId \
  -H "Authorization: Bearer YOUR_API_KEY"
````

## Restore Session

Restore an expired session from stored messages. This allows you to continue a conversation after the server-side state has expired.

```
POST /api/agent-sessions/:sessionId/restore
```

### Request Body

```json
{
  "messages": [
    {
      "id": "1702345800000-xyz789a",
      "role": "user",
      "parts": [{ "type": "text", "text": "How do I reset my password?", "status": "done" }],
      "status": "done",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "input": {
    "COMPANY_NAME": "Acme Corp"
  }
}
```

| Field      | Type        | Required | Description                                                    |
| ---------- | ----------- | -------- | -------------------------------------------------------------- |
| `messages` | UIMessage[] | Yes      | Previously stored chat history                                 |
| `input`    | object      | No       | Session input for system prompt interpolation (same as create) |

### Response

```json
{
  "sessionId": "cm5xyz123abc456def",
  "restored": true
}
```

| Field       | Type    | Description                                                             |
| ----------- | ------- | ----------------------------------------------------------------------- |
| `sessionId` | string  | The session ID                                                          |
| `restored`  | boolean | `true` if restored from messages, `false` if session was already active |

### Example

```bash
curl -X POST https://octavus.ai/api/agent-sessions/:sessionId/restore \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [...],
    "input": { "COMPANY_NAME": "Acme Corp" }
  }'
```

> **Note**: Store the `UIMessage[]` array after each interaction to enable restoration. The restore endpoint reconstructs the conversation state from these messages.

## Trigger Session

Execute a trigger on a session. Returns a Server-Sent Events stream.

```
POST /api/agent-sessions/:sessionId/trigger
```

### Request Body

```json
{
  "triggerName": "user-message",
  "input": {
    "USER_MESSAGE": "How do I reset my password?"
  },
  "toolResults": []
}
```

| Field         | Type   | Required | Description                                    |
| ------------- | ------ | -------- | ---------------------------------------------- |
| `triggerName` | string | Yes      | Name of the trigger to execute                 |
| `input`       | object | No       | Input variables for the trigger                |
| `toolResults` | array  | No       | Tool results for continuation (handled by SDK) |

### Response

Returns `text/event-stream` with SSE events:

```
data: {"type":"start","messageId":"msg-123"}

data: {"type":"block-start","blockId":"b1","blockName":"Add user message","blockType":"add-message","display":"hidden"}

data: {"type":"block-end","blockId":"b1"}

data: {"type":"block-start","blockId":"b2","blockName":"Respond to user","blockType":"next-message","display":"stream","outputToChat":true}

data: {"type":"text-start","id":"t1"}

data: {"type":"text-delta","id":"t1","delta":"I"}

data: {"type":"text-delta","id":"t1","delta":" can"}

data: {"type":"text-delta","id":"t1","delta":" help"}

data: {"type":"text-delta","id":"t1","delta":" you"}

data: {"type":"text-delta","id":"t1","delta":" reset"}

data: {"type":"text-delta","id":"t1","delta":" your"}

data: {"type":"text-delta","id":"t1","delta":" password"}

data: {"type":"text-delta","id":"t1","delta":"!"}

data: {"type":"text-end","id":"t1"}

data: {"type":"block-end","blockId":"b2"}

data: {"type":"finish","finishReason":"stop"}

data: [DONE]
```

### Event Types

| Event                   | Description                        |
| ----------------------- | ---------------------------------- |
| `start`                 | Stream started                     |
| `finish`                | Execution complete                 |
| `error`                 | Error occurred                     |
| `block-start`           | Execution block started            |
| `block-end`             | Execution block completed          |
| `text-start`            | Text generation started            |
| `text-delta`            | Incremental text content           |
| `text-end`              | Text generation ended              |
| `reasoning-start`       | Extended reasoning started         |
| `reasoning-delta`       | Reasoning content                  |
| `reasoning-end`         | Extended reasoning ended           |
| `tool-input-start`      | Tool call initiated                |
| `tool-input-delta`      | Tool arguments streaming           |
| `tool-input-end`        | Tool arguments streaming ended     |
| `tool-input-available`  | Tool input complete                |
| `tool-output-available` | Tool completed with result         |
| `tool-output-error`     | Tool failed                        |
| `tool-request`          | Platform requesting tool execution |
| `file-available`        | File ready for display/download    |
| `resource-update`       | Resource value changed             |

### Example

```bash
curl -N -X POST https://octavus.ai/api/agent-sessions/:sessionId/trigger \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "triggerName": "user-message",
    "input": { "USER_MESSAGE": "How do I reset my password?" }
  }'
```

## Tool Continuation

When the agent calls external tools, you'll receive a `tool-request` event. Execute the tools and send results back:

```json
{
  "triggerName": "user-message",
  "input": { "USER_MESSAGE": "..." },
  "toolResults": [
    {
      "toolCallId": "tc_123",
      "toolName": "get-user-account",
      "result": {
        "name": "Demo User",
        "email": "demo@example.com"
      }
    }
  ]
}
```

The Server SDK handles this continuation pattern automatically.

## Upload URLs

Get presigned URLs for file uploads. Files are uploaded directly to S3.

```
POST /api/files/upload-urls
```

### Request Body

```json
{
  "sessionId": "cm5xyz123abc456def",
  "files": [
    {
      "filename": "photo.jpg",
      "mediaType": "image/jpeg",
      "size": 102400
    }
  ]
}
```

| Field               | Type   | Required | Description                         |
| ------------------- | ------ | -------- | ----------------------------------- |
| `sessionId`         | string | Yes      | Session ID to associate files with  |
| `files`             | array  | Yes      | Array of file metadata (1-20 files) |
| `files[].filename`  | string | Yes      | Original filename                   |
| `files[].mediaType` | string | Yes      | MIME type (e.g., `image/png`)       |
| `files[].size`      | number | Yes      | File size in bytes                  |

### Response

```json
{
  "files": [
    {
      "id": "file-abc123",
      "uploadUrl": "https://s3.amazonaws.com/bucket/key?...",
      "downloadUrl": "https://s3.amazonaws.com/bucket/key?..."
    }
  ]
}
```

### Upload Flow

1. Request upload URLs from the platform
2. PUT file content to `uploadUrl` with `Content-Type` header
3. Use `downloadUrl` as the `url` in `FileReference`
4. Include `FileReference` in trigger input

### Supported Types

| Category  | Media Types                                                          |
| --------- | -------------------------------------------------------------------- |
| Images    | `image/jpeg`, `image/png`, `image/gif`, `image/webp`                 |
| Documents | `application/pdf`, `text/plain`, `text/markdown`, `application/json` |

### Limits

| Limit                 | Value      |
| --------------------- | ---------- |
| Max file size         | 10 MB      |
| Max total per request | 50 MB      |
| Max files per request | 20         |
| Upload URL expiry     | 15 minutes |
| Download URL expiry   | 24 hours   |
