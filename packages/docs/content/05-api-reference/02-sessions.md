---
title: Sessions
description: Session resources, triggers, continuations, messages, logs, and uploads.
---

# Sessions API

A session is a conversation with an agent: it holds the conversation history and the agent's variables. A session is a resource under `/api/v1/sessions`; its two records of the conversation (the UI transcript and the model history), its execution log, and the executions that run in it are resources of their own beneath it.

All session endpoints require an API key with the **Sessions** permission.

## The session resource

Every endpoint that creates or changes a session returns the session:

```json
{
  "id": "cm5xyz123abc456def",
  "agentId": "cm5xvz7k80001abcd",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

| Field       | Type   | Description                                                                                                                   |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string | The session ID                                                                                                                |
| `agentId`   | string | The agent the session runs                                                                                                    |
| `status`    | string | `active` while the platform holds the session's state; `expired` once that state has aged out (24 hours idle) or been cleared |
| `createdAt` | string | ISO 8601                                                                                                                      |

An expired session is not gone: its record stays, and [Restore Session](#restore-session) rebuilds its state from the model history you stored.

## Create Session

```
POST /api/v1/sessions
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

> **Getting the agent ID:** Copy the ID from the agent URL in the [platform](https://octavus.ai) (e.g., `octavus.ai/projects/.../agents/clxyz123`), look it up with [`GET /api/v1/agents?slug=`](/docs/api-reference/agents#list-agents), or use the [CLI](/docs/server-sdk/cli) (`octavus sync ./agents/my-agent` prints it).

### Response

`201` with the [session](#the-session-resource).

### Example

```bash
curl -X POST https://octavus.ai/api/v1/sessions \
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

## Start Session

Create a session and run its first trigger in one streaming request. The response is the trigger's event stream (see [Trigger Session](#trigger-session)); the created session's ID is in the `X-Octavus-Session-Id` response header and on the first `start` event.

```
POST /api/v1/sessions/start
```

### Request Body

```json
{
  "agentId": "cm5xvz7k80001abcd",
  "input": { "COMPANY_NAME": "Acme Corp" },
  "idempotencyKey": "chat-8f2c41d0",
  "trigger": {
    "triggerName": "user-message",
    "input": { "USER_MESSAGE": "Hello" }
  }
}
```

| Field            | Type   | Required | Description                                                                                                                           |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`        | string | Yes      | Agent ID                                                                                                                              |
| `input`          | object | No       | The session's input variables                                                                                                         |
| `idempotencyKey` | string | No       | A retried start with the same key resolves to the session the first request created instead of creating another (1-200 chars)         |
| `trigger`        | object | Yes      | The first trigger: `triggerName`, `input`, `sender`, `userMessageId`, `dynamicToolSchemas`, as on [Trigger Session](#trigger-session) |

## Get Session

```
GET /api/v1/sessions/:sessionId
```

Returns the [session](#the-session-resource). The conversation itself is read from [Get UI Messages](#get-ui-messages) (what the person saw) and [Get Model History](#get-model-history) (what the model produced).

### Example

```bash
curl https://octavus.ai/api/v1/sessions/:sessionId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Get UI Messages

```
GET /api/v1/sessions/:sessionId/ui-messages
```

The UI transcript: the session's conversation as the UI renders it, with each part revealing what its [display mode](/docs/protocol/tools#display-modes) allows - what the live stream showed. Each trigger produces one assistant message for the whole turn, however many tool rounds it takes: the message's `parts` hold every step in order, with a `step-start` part between steps - the same shape the client SDK builds while the turn streams. A handler that adds a message mid-turn (an `add-message` block after output has already been produced) continues in a new assistant message after it, so history keeps its order.

A turn that is paused for tools - waiting for your server or client to continue it - is still in progress: its message has `status: "streaming"`, and its tool calls and sub-agent cards that await a result read `running`. A tool call a finished turn never resolved reads `cancelled`.

An expired session has no messages: the response is `{ "messages": [] }`. Read [Get Session](#get-session) for the status.

> **Note**: For an agent configured with [context management](/docs/protocol/context-management) (`maxToolOutputTokens` and/or `contextManagement`), the messages reflect the agent's **bounded working memory**, not a byte-complete transcript: tool results are the bounded previews and, once the session has compacted, older turns are represented by the running summary. For the complete, untruncated history - every tool result at full size - read the session's [execution log](#get-logs), which is the durable record.

### Response

```json
{
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
        {
          "type": "tool-call",
          "toolCallId": "call_1",
          "toolName": "get-user-account",
          "title": "Looking up your account",
          "display": "title",
          "args": {},
          "status": "done"
        },
        { "type": "text", "text": "I can help you reset your password...", "status": "done" }
      ],
      "status": "done",
      "createdAt": "2024-01-15T10:30:05.000Z"
    }
  ]
}
```

A part reveals the same things here as its events did live: a `title`-mode tool call carries its `title` and status but no `args` or `result`; a `stream`-mode one carries both. Timestamps are ISO 8601 strings.

### UIMessage Parts

Messages contain typed `parts` that preserve content ordering:

| Part Type    | Description                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------- |
| `text`       | Text content with `text` and `status` fields                                                 |
| `reasoning`  | Extended reasoning with `text` and `status` fields                                           |
| `tool-call`  | Tool execution with `toolCallId`, `toolName`, `title`, `display`, `args`, `result`, `status` |
| `operation`  | A block's operation card with `operationId`, `name`, `operationType`, `title`, `status`      |
| `worker`     | A sub-agent card with `workerId`, `workerSlug`, `title`, `display`, nested `parts`, `status` |
| `file`       | File attachment with `id`, `mediaType`, `url`, `filename`, `size`                            |
| `source`     | Source reference with `sourceType`, `id`, `url`, `title`                                     |
| `object`     | Structured output with `id`, `typeName`, `object`, `status`                                  |
| `step-start` | The boundary between two model steps of one turn                                             |

The list grows over time; keep a part of an unknown `type` and skip it when rendering (see [Versioning](/docs/api-reference/versioning)).

## Get Model History

```
GET /api/v1/sessions/:sessionId/model-history?toolResults=full|trimmed
```

The model history: the model's record of the session, to store after each settled turn and hand back to [Restore Session](#restore-session) once the session's state has expired. Independent of display modes: every message as the model produced it, in the provider's emission order, with every tool call (the `hidden` ones and the sub-agent delegations included), plus the named threads, the context-compaction state, and the variables. The system prompt is not carried; a restore rebuilds it from the agent's current definition.

### Query Parameters

| Parameter     | Type   | Required | Description                                                                                                                                                                                                                                                |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolResults` | string | Yes      | How much of each tool result the record keeps: `full` (every result as stored) or `trimmed` (every result replaced by the placeholder the platform uses for a result it no longer holds, so the model re-makes a call when it needs the data). No default. |

### Response

```json
{
  "version": 1,
  "sessionId": "cm5xyz123abc456def",
  "agentId": "cm5xvz7k80001abcd",
  "createdAt": "2024-01-15T10:35:00.000Z",
  "toolResults": "trimmed",
  "messages": [...],
  "threads": {...},
  "contextCompaction": {...},
  "variables": {},
  "signature": "k3Jx...Q9w"
}
```

| Field               | Type   | Description                                                                                                           |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `version`           | number | The record's format version; a restore refuses a version the platform no longer reads                                 |
| `sessionId`         | string | The session the record was read from; it restores that session only                                                   |
| `agentId`           | string | The session's agent                                                                                                   |
| `createdAt`         | string | When the record was read (ISO 8601)                                                                                   |
| `toolResults`       | string | The mode it was read with                                                                                             |
| `messages`          | array  | The model's record of the conversation, in the platform's own shape                                                   |
| `threads`           | object | The named threads, when the session has any                                                                           |
| `contextCompaction` | object | The context-compaction state, once the session has compacted                                                          |
| `variables`         | object | The session's variables                                                                                               |
| `signature`         | string | The platform's signature over the record's content. A record that was changed after it was read is refused on restore |

Store the document as it is: readable JSON you may inspect, never edit. The fields beyond the envelope (`messages`, `threads`, `contextCompaction`) are the platform's own shapes and may change between versions; a restore reads them, your code should not.

### Errors

| Status | Code               | When                                                                                                                                                                                                  |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | `toolResults` is missing or not one of `full`, `trimmed`                                                                                                                                              |
| `409`  | `TURN_IN_PROGRESS` | A turn is running or paused for tools; the record covers settled turns only. Read it after a `finish` that ends the turn, not one that pauses it for tools or yields a leg (`tool-calls`, `continue`) |
| `409`  | `SESSION_EXPIRED`  | The session's state has expired, so there is nothing to read; the record you stored stands                                                                                                            |

### Example

```bash
curl "https://octavus.ai/api/v1/sessions/:sessionId/model-history?toolResults=trimmed" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Restore Session

Restore an expired session from the model history you stored, so a conversation continues after the server-side state has expired: the faithful restore. The record's messages, threads, compaction state, and variables become the session's state as they were; the system prompt is rebuilt from the agent's current definition and the given `input`.

```
POST /api/v1/sessions/:sessionId/restore
```

### Request Body

```json
{
  "modelHistory": {
    "version": 1,
    "sessionId": "cm5xyz123abc456def",
    "agentId": "cm5xvz7k80001abcd",
    "createdAt": "2024-01-15T10:35:00.000Z",
    "toolResults": "trimmed",
    "messages": [...],
    "variables": {},
    "signature": "k3Jx...Q9w"
  },
  "input": {
    "COMPANY_NAME": "Acme Corp"
  }
}
```

| Field          | Type   | Required | Description                                                            |
| -------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `modelHistory` | object | Yes      | The record [Get Model History](#get-model-history) returned, unchanged |
| `input`        | object | No       | Session input for system prompt interpolation (same as create)         |

### Response

The [session](#the-session-resource), `active` again. A session whose state was still live is left as it is.

### Errors

| Status | Code                                | When                                                                                         |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `400`  | `MODEL_HISTORY_SIGNATURE_INVALID`   | The record's content was changed after it was read, or it was not produced by the platform   |
| `400`  | `MODEL_HISTORY_VERSION_UNSUPPORTED` | The record's `version` is one the platform no longer reads; read the session's history again |
| `400`  | `MODEL_HISTORY_MISMATCH`            | The record belongs to another session or agent than the one being restored                   |

### Example

```bash
curl -X POST https://octavus.ai/api/v1/sessions/:sessionId/restore \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "modelHistory": {...},
    "input": { "COMPANY_NAME": "Acme Corp" }
  }'
```

## Restore Session from UI Messages

Restore an expired session from the UI transcript you stored: the best-effort restore, for a conversation of which only [the UI messages](#get-ui-messages) were kept. The transcript is shaped by display modes, so the rebuilt history carries only what it revealed: a `hidden` tool call is gone, a `title`-mode call comes back without its arguments or result, a sub-agent delegation and its output are gone, and the named threads, the compaction state, and the variables are not carried. A `stream` call comes back whole. Prefer [Restore Session](#restore-session) with the model history.

```
POST /api/v1/sessions/:sessionId/restore-from-ui-messages
```

### Request Body

```json
{
  "uiMessages": [
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

| Field        | Type        | Required | Description                                                    |
| ------------ | ----------- | -------- | -------------------------------------------------------------- |
| `uiMessages` | UIMessage[] | Yes      | The transcript [Get UI Messages](#get-ui-messages) returned    |
| `input`      | object      | No       | Session input for system prompt interpolation (same as create) |

### Response

The [session](#the-session-resource), `active` again. A session whose state was still live is left as it is.

## Clear Session

Clear the session's state. The session becomes `expired` and can be restored afterwards with [Restore Session](#restore-session). Idempotent: clearing an already expired session succeeds.

```
DELETE /api/v1/sessions/:sessionId
```

### Response

The [session](#the-session-resource), with `status: "expired"`.

### Example

```bash
curl -X DELETE https://octavus.ai/api/v1/sessions/:sessionId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Trigger Session

Run a trigger on the session: start a new turn and stream it as Server-Sent Events.

```
POST /api/v1/sessions/:sessionId/trigger
```

### Request Body

```json
{
  "triggerName": "user-message",
  "input": {
    "USER_MESSAGE": "How do I reset my password?"
  }
}
```

| Field                    | Type           | Required | Description                                                                                                                                            |
| ------------------------ | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggerName`            | string         | Yes      | Name of the trigger to execute                                                                                                                         |
| `input`                  | object         | No       | Input variables for the trigger                                                                                                                        |
| `rollbackAfterMessageId` | string \| null | No       | For retry: ID of the last message to keep. Messages after this are removed. `null` = truncate all.                                                     |
| `sender`                 | object         | No       | Author of this turn (`{ id?, name?, image? }`), stamped onto the user message as `UIMessage.sender`. Turn metadata, not a trigger input.               |
| `userMessageId`          | string         | No       | The id to persist this turn's user message under (1-128 chars), applied when no message in the session has it yet. Turn metadata, not a trigger input. |
| `dynamicToolSchemas`     | array          | No       | Schemas of tools the caller discovered at runtime (an MCP server's), offered to the model for this turn                                                |

### Response

Returns `text/event-stream` with SSE events:

```
data: {"type":"start","executionId":"exec_123","sessionId":"cm5xyz123abc456def","messageId":"msg-123"}

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

The `start` event names the execution (`executionId`); a [continuation](#continue-execution) addresses it. A turn ends in one of three ways, told by the `finish` event's `finishReason`: `stop` (the turn is complete), `tool-calls` (the turn is paused on the calls of the preceding `tool-request` event, see [Tool Continuation](#tool-continuation)), or `continue` (the leg reached its time budget, see [Execution Legs](#execution-legs)). Aborting the request stops generation; what was produced is kept.

### Event Types

| Event                   | Description                        |
| ----------------------- | ---------------------------------- |
| `start`                 | Stream started                     |
| `finish`                | Stream ended (see `finishReason`)  |
| `error`                 | Error occurred                     |
| `block-start`           | Execution block started            |
| `block-end`             | Execution block completed          |
| `step-start`            | A later model step started         |
| `step-discard`          | Current step's output retracted    |
| `persisted`             | Session state saved up to here     |
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
| `worker-start` ...      | Sub-agent lifecycle (see the SDK)  |

The list grows over time. Read an event of an unknown `type` as one to ignore or forward, and keep any field you do not know; see [Versioning](/docs/api-reference/versioning).

### Example

```bash
curl -N -X POST https://octavus.ai/api/v1/sessions/:sessionId/trigger \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "triggerName": "user-message",
    "input": { "USER_MESSAGE": "How do I reset my password?" }
  }'
```

## Continue Execution

Continue the execution a session's turn paused in: deliver the results of the tools you ran, or resume a leg that reached its time budget. Returns the rest of the turn as the same event stream a trigger does.

```
POST /api/v1/sessions/:sessionId/executions/:executionId/continue
```

### Request Body

```json
{
  "toolResults": [
    {
      "toolCallId": "tc_123",
      "result": {
        "name": "Demo User",
        "email": "demo@example.com"
      }
    }
  ]
}
```

| Field                      | Type    | Required | Description                                                                    |
| -------------------------- | ------- | -------- | ------------------------------------------------------------------------------ |
| `toolResults`              | array   | No       | The results of the calls you ran; empty (or omitted) to resume a yielded leg   |
| `toolResults[].toolCallId` | string  | Yes      | The call's ID from the `tool-request` event                                    |
| `toolResults[].result`     | any     | No       | What the tool returned                                                         |
| `toolResults[].error`      | string  | No       | Why the tool failed, instead of a result                                       |
| `toolResults[].files`      | array   | No       | `FileReference`s the tool produced                                             |
| `toolResults[].truncated`  | boolean | No       | True when you reduced the result to a preview because it was too large to send |
| `dynamicToolSchemas`       | array   | No       | As on [Trigger Session](#trigger-session)                                      |

### Tool Continuation

When the agent calls tools the platform does not run itself, the stream carries a `tool-request` event with the pending calls and ends with `finish: tool-calls`:

```
data: {"type":"tool-request","toolCalls":[{"toolCallId":"tc_123","toolName":"get-user-account","args":{"userId":"user-123"},"display":"title"}]}

data: {"type":"finish","finishReason":"tool-calls","executionId":"exec_123"}
```

Each pending call carries its `toolCallId`, `toolName`, `args`, and `display` (what your own output events may reveal), plus `thread` and `workerId` when it came from a sub-agent or a thread. Run the tools and send the results back on this endpoint. The platform routes each result by the call it recorded when it issued it: a result for a call the execution did not request is refused with `400` and the code `UNKNOWN_TOOL_CALL`, a second result for a call that already has one is ignored, and so is a result re-sent for a call the execution already applied, so a continuation retried after a dropped connection is safe.

A continuation that answers only some of the open calls does not run the agent: it is answered with a `tool-request` for the calls still open and `finish: tool-calls`, so several executors (your server, the browser) can each submit what they ran. The execution resumes once every call has a result.

The Server SDK handles this continuation pattern automatically.

### Execution Legs

A long turn runs as a chain of server invocations, each bounded in time. When an invocation reaches its budget, the platform saves the turn's progress and ends that leg with a `persisted` event followed by `finish` with `finishReason: "continue"`. Nothing is pending: resume the same execution with an empty continuation.

```json
{ "toolResults": [] }
```

The next leg streams from where the previous one stopped, into the same assistant message, and ends with its own `finish` - another `continue`, a `tool-calls` pause, or the final `stop`. The model never sees the boundary. The Server SDK performs the continuation itself, so `session.execute()` yields one stream for the whole turn; a raw caller must resume a `continue` leg itself.

### Errors

A continuation for an execution the session no longer holds - it finished, expired, or was lost before its first save - returns `409` with the error code `EXECUTION_NOT_RESUMABLE`. Re-send the original trigger to start the turn over.

## Get Logs

```
GET /api/v1/sessions/:sessionId/logs
```

The session's execution log: the chronological trace of everything that happened during its executions - triggers, model requests, tool calls and results, sub-agent runs, errors. The durable record, where the messages are the agent's working memory.

### Query Parameters

| Parameter              | Type    | Description                                                                                      |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `excludeModelRequests` | boolean | `true` leaves out `model-request` entries, which carry full provider payloads when tracing is on |

### Response

```json
{
  "entries": [
    {
      "id": "...",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "type": "trigger",
      "triggerName": "user-message"
    }
  ],
  "total": 1,
  "truncated": false
}
```

| Field       | Type    | Description                                                                          |
| ----------- | ------- | ------------------------------------------------------------------------------------ |
| `entries`   | array   | The entries, oldest first; the most recent ones when the response was capped         |
| `total`     | number  | The number of entries on the server, which exceeds `entries.length` when `truncated` |
| `truncated` | boolean | True when the response was capped (at 3000 entries)                                  |

An expired session has no log: `{ "entries": [], "total": 0, "truncated": false }`. Entry types grow over time; handle an unknown `type` with a default branch.

## Uploads

Get presigned URLs for uploading files to a session. Files are uploaded directly to S3; the session must be active.

```
POST /api/v1/sessions/:sessionId/uploads
```

### Request Body

```json
{
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
| `files`             | array  | Yes      | Array of file metadata (1-20 files) |
| `files[].filename`  | string | Yes      | Original filename                   |
| `files[].mediaType` | string | Yes      | MIME type (e.g., `image/png`)       |
| `files[].size`      | number | Yes      | File size in bytes                  |

### Response

`201`:

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

## File View URL

A short-lived view URL for a file the session produced, to render it inline (in a sandboxed frame) without exposing the storage URL.

```
POST /api/v1/sessions/:sessionId/files/view-url
```

### Request Body

```json
{ "fileUrl": "https://s3.amazonaws.com/bucket/key?..." }
```

### Response

```json
{ "viewUrl": "https://.../outputs/sessions/cm5xyz123abc456def/report.html?..." }
```

`viewUrl` is a signed URL on the platform's content domain. It is `null` when the file is not one the session owns or viewing is unavailable; fall back to the file's download URL.
