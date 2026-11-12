---
title: Sessions
description: Session resources, triggers, continuations, messages, logs, and uploads.
---

# Sessions API

A session is a conversation with an agent: it holds the conversation history and the agent's variables. A session is a resource under `/api/v1/sessions`; its messages, its execution log, and the executions that run in it are resources of their own beneath it.

Two ids run through this API. A session's `id` is the one to keep: its messages, its log, and its page in the dashboard are read by it. An execution's `executionId` names one turn inside the session, and its only use is to [continue](#continue-execution) that turn while it is paused.

A [worker run](/docs/api-reference/agents#run-worker) is a session too, created by running the worker: [Create Session](#create-session) and [Start Session](#start-session) refuse a worker agent with `400` and the code `VALIDATION_ERROR`. [Get Session](#get-session) and [Get Logs](#get-logs) read the run by the `sessionId` its `start` event carries. It holds no conversation, so [Get Messages](#get-messages) answers empty, [Start Execution](#start-execution), [Continue Execution](#continue-execution), and [Restore Session](#restore-session) answer `400` with the code `VALIDATION_ERROR`, and [Clear Session](#clear-session) discards its state and log.

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

An expired session is not gone: its record stays, and [Restore Session](#restore-session) rebuilds its state from the messages you stored. Its reads keep working and answer empty ([Get Messages](#get-messages), [Get Logs](#get-logs)), and its files stay viewable ([File View URL](#file-view-url)). What needs the live state - [starting an execution](#start-execution) or [requesting upload URLs](#uploads) - answers `409` with the code `SESSION_EXPIRED`, which tells an expired session apart from one that does not exist (`404`): restore it, or create a new one.

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

`201` with the [session](#the-session-resource), and its path in the `Location` header. A worker agent is refused with `400` and the code `VALIDATION_ERROR`: a worker's session is created by [running it](/docs/api-reference/agents#run-worker).

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

Create a session and run its first trigger in one streaming request. The response is the execution's event stream (see [Start Execution](#start-execution)); the created session's ID is in the `Octavus-Session-Id` response header and on the first `start` event.

```
POST /api/v1/sessions/start
```

### Request Body

```json
{
  "agentId": "cm5xvz7k80001abcd",
  "input": { "COMPANY_NAME": "Acme Corp" },
  "trigger": {
    "triggerName": "user-message",
    "input": { "USER_MESSAGE": "Hello" }
  }
}
```

| Field     | Type   | Required | Description                                                                                                                           |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId` | string | Yes      | Agent ID                                                                                                                              |
| `input`   | object | No       | The session's input variables                                                                                                         |
| `trigger` | object | Yes      | The first trigger: `triggerName`, `input`, `sender`, `userMessageId`, `dynamicToolSchemas`, as on [Start Execution](#start-execution) |

### Idempotency

Send an `Idempotency-Key` header with a value unique to the conversation, such as your chat id (1-255 printable ASCII characters, no spaces):

```
Idempotency-Key: chat-8f2c41d0
```

A retried start under the same key resolves to the session the first request created instead of creating another, and runs its trigger on that session: a request whose response was lost leaves one session behind, not two, and its trigger runs as a turn on it. A key is remembered for 10 minutes. A retry that arrives while the first request is still creating the session fails with `409 SESSION_START_IN_PROGRESS`; retry after a moment.

## Get Session

```
GET /api/v1/sessions/:sessionId
```

Returns the [session](#the-session-resource). The conversation itself is read from [Get Messages](#get-messages).

### Example

```bash
curl https://octavus.ai/api/v1/sessions/:sessionId \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Get Messages

```
GET /api/v1/sessions/:sessionId/messages
```

The session's conversation as the UI renders it. Each trigger produces one assistant message for the whole turn, however many tool rounds it takes: the message's `parts` hold every step in order, with a `step-start` part between steps - the same shape the client SDK builds while the turn streams. A handler that adds a message mid-turn (an `add-message` block after output has already been produced) continues in a new assistant message after it, so history keeps its order.

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

## Restore Session

Restore an expired session from the messages you stored ([Get Messages](#get-messages)), so a conversation continues after the server-side state has expired. The messages carry what their [display modes](/docs/protocol/tools#display-modes) revealed, and the restore rebuilds the model's history from that: a `stream` tool call comes back with its arguments and result, a `title` call with empty arguments and a placeholder result, and a `hidden` call not at all.

```
POST /api/v1/sessions/:sessionId/restore
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
| `messages` | UIMessage[] | Yes      | The stored `UIMessage[]`                                       |
| `input`    | object      | No       | Session input for system prompt interpolation (same as create) |

### Response

The [session](#the-session-resource), `active` again. A session whose state was still live is left as it is.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/sessions/:sessionId/restore \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [...],
    "input": { "COMPANY_NAME": "Acme Corp" }
  }'
```

> **Note**: Store the `UIMessage[]` array after each interaction to enable restoration. The restore endpoint reconstructs the conversation state from these messages.

## Clear Session

Clear the session's state, the mirror of [Restore Session](#restore-session): the session's record stays, it becomes `expired`, and it can be restored afterwards. Idempotent: clearing an already expired session succeeds.

```
POST /api/v1/sessions/:sessionId/clear
```

### Response

The [session](#the-session-resource), with `status: "expired"`.

### Example

```bash
curl -X POST https://octavus.ai/api/v1/sessions/:sessionId/clear \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Start Execution

Start an execution on the session: run a trigger, which starts a new turn, and stream it as Server-Sent Events. The `start` event names the execution, and a [continuation](#continue-execution) addresses it.

```
POST /api/v1/sessions/:sessionId/executions
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
data: {"type":"start","executionId":"3f1c9b2e-6d4a-4c8e-9f0b-2a7d5e8c1b4f","sessionId":"cm5xyz123abc456def","messageId":"msg-123"}

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
curl -N -X POST https://octavus.ai/api/v1/sessions/:sessionId/executions \
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
| `dynamicToolSchemas`       | array   | No       | As on [Start Execution](#start-execution)                                      |

### Tool Continuation

When the agent calls tools the platform does not run itself, the stream carries a `tool-request` event with the pending calls and ends with `finish: tool-calls`:

```
data: {"type":"tool-request","toolCalls":[{"toolCallId":"tc_123","toolName":"get-user-account","args":{"userId":"user-123"},"display":"title"}]}

data: {"type":"finish","finishReason":"tool-calls","executionId":"3f1c9b2e-6d4a-4c8e-9f0b-2a7d5e8c1b4f"}
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

Get presigned URLs for uploading files to a session. Files are uploaded directly to S3; the session must be active (an expired one is `409 SESSION_EXPIRED`).

A file is a project resource: this route creates the same project files as [`POST /api/v1/files`](/docs/api-reference/files), recorded as uploaded for the session, and the reference is accepted by a session input, a trigger, a worker run, and a Workforce dispatch alike. Use the files route when no session exists yet or the same credential uploads and triggers. Use this route when the file will be used by a credential narrower than yours - an [ephemeral token](/docs/authentication/ephemeral-tokens) scoped to this session or its agent reaches only the files tied to them, so a file a project key reserved without a session is out of its reach.

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

The supported types and the limits are those of the [Files API](/docs/api-reference/files#supported-types): 100 MB per file, 200 MB per request, 20 files per request, a 15-minute upload URL, and a 7-day download URL.

## File View URL

A short-lived view URL for a file the session shows (one it produced, uploaded, or accepted as input), to render it inline (in a sandboxed frame) without exposing the storage URL. The files outlive the session's state, so this works for an expired session too.

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

`viewUrl` is a signed URL on the platform's content domain. It is `null` when the file is not one the session shows or viewing is unavailable; fall back to the file's download URL.
