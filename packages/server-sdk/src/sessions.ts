import { z } from 'zod';
import {
  uiMessageSchema,
  type ExecutionLogEntry,
  type InlineMcpServer,
  type PendingToolCall,
  type ToolHandlers,
  type ToolResult,
  type UIMessage,
} from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { AgentSession } from '@/session.js';
import type { ToolResultTruncation } from '@/tool-result-size.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum(['active', 'expired']);

export const sessionSchema = z.looseObject({
  id: z.string(),
  agentId: z.string(),
  status: sessionStatusSchema,
  createdAt: z.string(),
});

const sessionUiMessagesResponseSchema = z.looseObject({
  messages: z.array(uiMessageSchema),
});

export const modelHistoryToolResultsSchema = z.enum(['full', 'trimmed']);

/**
 * The model history as the platform returns it. Loose and shallow on purpose:
 * the record is the platform's, signed over its whole content, and is handed
 * back unchanged, so the SDK keeps every field it carries and never reshapes
 * it.
 */
export const modelHistorySchema = z.looseObject({
  version: z.number(),
  sessionId: z.string(),
  agentId: z.string(),
  createdAt: z.string(),
  toolResults: modelHistoryToolResultsSchema,
  signature: z.string(),
});

/**
 * Validates the envelope and base fields of each entry without being strict
 * about per-type fields. This keeps the SDK forward-compatible when the server
 * adds new entry types - unknown types pass through instead of failing validation.
 * Consumers narrow on `entry.type` using the TypeScript discriminated union.
 */
const executionLogEntrySchema = z.looseObject({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
});

const executionLogsResponseSchema = z.looseObject({
  entries: z.array(executionLogEntrySchema),
  total: z.number(),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Whether the platform still holds the session's state. */
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * A session: its agent, when it was created, and whether its state is still
 * `active` or has `expired` (aged out or cleared). An expired session is
 * restored from the model history you stored with `restoreFromModelHistory()`.
 */
export interface Session {
  id: string;
  agentId: string;
  status: SessionStatus;
  createdAt: string;
}

/**
 * How much of each tool result a model history keeps:
 * - `full`: every result as the session stored it. The conversation continues
 *   exactly as if the session had never expired; the largest record.
 * - `trimmed`: every result replaced by the placeholder the platform uses for
 *   a result it no longer holds (a sub-agent delegation keeps its output; the
 *   sub-agent's own tool results are replaced the same way). The model still
 *   sees every call it made, with its arguments, and re-makes a call when it
 *   needs the data; the smallest record that restores a conversation
 *   faithfully in structure.
 */
export type ModelHistoryToolResults = z.infer<typeof modelHistoryToolResultsSchema>;

export interface GetModelHistoryOptions {
  /** How much of each tool result the record keeps. Required: every consumer chooses. */
  toolResults: ModelHistoryToolResults;
}

/**
 * The model's record of a session: every message as the model produced it,
 * with every tool call (the hidden ones and the worker delegations included),
 * the named threads, the compaction state, and the variables - everything a
 * continuation needs after the session's state has expired, independent of
 * what the UI showed. Signed by the platform: store it and hand it back to
 * `restoreFromModelHistory()` exactly as it was returned (a changed record is
 * refused). Readable JSON, so you can inspect what you are storing; the
 * fields beyond these are the platform's and are not part of the SDK's
 * contract.
 */
export interface ModelHistory {
  /** The record's format version; the platform refuses a version it no longer reads. */
  version: number;
  sessionId: string;
  agentId: string;
  /** When the record was read (ISO 8601). */
  createdAt: string;
  /** The mode the record was read with. */
  toolResults: ModelHistoryToolResults;
  /** The platform's signature over the record's content. */
  signature: string;
  [key: string]: unknown;
}

export interface GetLogsOptions {
  /**
   * Exclude model-request entries. These are lightweight markers by default,
   * but carry the full provider request payload when model request tracing
   * is enabled.
   */
  excludeModelRequests?: boolean;
}

/** A session's execution log. Empty once the session's state has expired. */
export interface ExecutionLogs {
  entries: ExecutionLogEntry[];
  /** Total number of entries available server-side. Exceeds `entries.length` when the response was capped. */
  total: number;
  /** True when the response was capped and only the most recent entries were returned. */
  truncated: boolean;
}

export interface SessionAttachOptions {
  tools?: ToolHandlers;
  /** Inline MCP servers providing namespaced, typed tool groups */
  mcpServers?: InlineMcpServer[];
  /** Called after server-side tools execute, before yielding events or continuing. Use to normalize tool results (e.g., upload base64 images). */
  onToolResults?: (results: ToolResult[]) => Promise<void>;
  /** When true, unhandled tool calls return errors instead of being emitted as client-tool-request events. */
  rejectClientToolCalls?: boolean;
  /**
   * Resolve a suspending pending tool call (one whose schema declared `suspend`):
   * the resident executor holds the call open and returns its result when an
   * external event arrives, so one continuous turn hosts a long-lived interaction
   * (e.g. a real-time session). Receives the abort signal so a Stop unblocks the
   * wait.
   */
  onSuspend?: (call: PendingToolCall, signal?: AbortSignal) => Promise<unknown>;
  /** Called for each tool result reduced to a preview because it was too large to send. */
  onToolResultTruncated?: (info: ToolResultTruncation) => void;
}

export interface StartSessionOptions extends SessionAttachOptions {
  /** Agent to start a session for. */
  agentId: string;
  /** Immutable session input, captured at the first trigger (not at this call). */
  input?: Record<string, unknown>;
  /**
   * Idempotency key so a transient retry of the first request resolves to the
   * same session instead of creating a duplicate. Auto-generated if omitted.
   */
  idempotencyKey?: string;
  /**
   * Called with the server-assigned session id as soon as it is known (before
   * events stream). Use it to persist your own mapping (e.g. chat -> session).
   */
  onSessionCreated?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** API for managing sessions */
export class SessionsApi extends BaseApiClient {
  /** Create a session for an agent. `input` is the immutable session input (protocol variables). */
  async create(agentId: string, input?: Record<string, unknown>): Promise<Session> {
    return await this.httpPost('/api/v1/sessions', { agentId, input }, sessionSchema);
  }

  /**
   * Get a session: its agent, when it was created, and whether its state is
   * still `active` or has `expired`. The conversation is read with
   * `getUiMessages()` (what a person saw) and `getModelHistory()` (what the
   * model produced).
   */
  async get(sessionId: string): Promise<Session> {
    return await this.httpGet(`/api/v1/sessions/${sessionId}`, sessionSchema);
  }

  /**
   * The UI transcript: the session's conversation as the UI renders it, the
   * visible messages with each part revealing what its display mode allows -
   * what the live stream showed. Pass them to `initialMessages` on the client
   * after a refresh, and store them to show an old conversation. Empty once the
   * session's state has expired.
   *
   * To continue a conversation after its state expires, store the model
   * history (`getModelHistory()`) rather than this transcript.
   */
  async getUiMessages(sessionId: string): Promise<UIMessage[]> {
    const { messages } = await this.httpGet(
      `/api/v1/sessions/${sessionId}/ui-messages`,
      sessionUiMessagesResponseSchema,
    );
    return messages;
  }

  /**
   * The model history: the model's record of the session, for continuing the
   * conversation after its state has expired. Read it after each settled turn
   * and store it as it is; hand it back to `restoreFromModelHistory()` later.
   * `toolResults` picks how much of each tool result the record keeps (`full`
   * or `trimmed`).
   *
   * Covers settled turns only: while a turn is running or paused for tools the
   * platform answers `409` with the code `TURN_IN_PROGRESS`, and once the
   * session's state has expired `409` with `SESSION_EXPIRED` (the record you
   * stored stands). A turn has settled at the stream's `finish`, except a
   * `finish` with `client-tool-calls`, which pauses the turn for the browser's
   * tools: read the record after the continuation's finish instead.
   */
  async getModelHistory(sessionId: string, options: GetModelHistoryOptions): Promise<ModelHistory> {
    return await this.httpGet(`/api/v1/sessions/${sessionId}/model-history`, modelHistorySchema, {
      toolResults: options.toolResults,
    });
  }

  /**
   * Restore an expired session from the model history you stored: the
   * faithful restore. The conversation continues with every message, tool
   * call, thread, and the compaction state as they were; with a `trimmed`
   * record the model re-makes a call when it needs a result. The system
   * prompt is rebuilt from the agent's current definition and `input`.
   *
   * @param sessionId - The session to restore
   * @param modelHistory - The record `getModelHistory()` returned, unchanged
   * @param input - The session input the system prompt is rebuilt from (the same as at creation)
   * @returns The session, `active` again (a session that was still active is left as it is)
   * @throws OctavusError with code `MODEL_HISTORY_SIGNATURE_INVALID` (the record was changed),
   *   `MODEL_HISTORY_VERSION_UNSUPPORTED` (the platform no longer reads its version), or
   *   `MODEL_HISTORY_MISMATCH` (it belongs to another session or agent)
   */
  async restoreFromModelHistory(
    sessionId: string,
    modelHistory: ModelHistory,
    input?: Record<string, unknown>,
  ): Promise<Session> {
    return await this.httpPost(
      `/api/v1/sessions/${sessionId}/restore`,
      { modelHistory, input },
      sessionSchema,
    );
  }

  /**
   * Restore an expired session from the UI transcript you stored: the
   * best-effort restore, for a conversation of which only `getUiMessages()`
   * was kept. The transcript is shaped by display modes, so the model gets back
   * only what it revealed: a `hidden` tool call is gone, a `title`-mode call
   * comes back without its arguments or result, and a worker delegation is
   * gone. Store `getModelHistory()` and restore with `restoreFromModelHistory()`
   * for a faithful continuation.
   *
   * @deprecated Best effort by nature; fully supported for conversations stored
   *   as UI messages. For new code, store the model history
   *   (`getModelHistory()`) and restore with `restoreFromModelHistory()`.
   * @param sessionId - The session to restore
   * @param uiMessages - The `UIMessage[]` `getUiMessages()` returned
   * @param input - The session input the system prompt is rebuilt from (the same as at creation)
   * @returns The session, `active` again (a session that was still active is left as it is)
   */
  async restoreFromUiMessages(
    sessionId: string,
    uiMessages: UIMessage[],
    input?: Record<string, unknown>,
  ): Promise<Session> {
    return await this.httpPost(
      `/api/v1/sessions/${sessionId}/restore-from-ui-messages`,
      { uiMessages, input },
      sessionSchema,
    );
  }

  /**
   * Clear the session's state from the server. The session becomes `expired`
   * and can be restored with `restoreFromModelHistory()`. Idempotent: succeeds
   * when the state was already gone.
   */
  async clear(sessionId: string): Promise<Session> {
    return await this.httpDelete(`/api/v1/sessions/${sessionId}`, sessionSchema);
  }

  /**
   * Get the session's execution log: the chronological trace of everything
   * that happened during execution.
   *
   * Entries are typed as `ExecutionLogEntry` (a discriminated union) for convenient
   * narrowing on `entry.type`. New entry types may be added server-side - include a
   * `default` case when switching on `type` to handle unknown variants gracefully.
   *
   * Empty once the session's state has expired.
   */
  async getLogs(sessionId: string, options?: GetLogsOptions): Promise<ExecutionLogs> {
    const logs = await this.httpGet(
      `/api/v1/sessions/${sessionId}/logs`,
      executionLogsResponseSchema,
      options?.excludeModelRequests ? { excludeModelRequests: 'true' } : undefined,
    );
    return logs as ExecutionLogs;
  }

  /** Attach to an existing session for triggering events */
  attach(sessionId: string, options: SessionAttachOptions = {}): AgentSession {
    return new AgentSession({
      sessionId,
      config: this.config,
      tools: options.tools,
      mcpServers: options.mcpServers,
      onToolResults: options.onToolResults,
      onToolResultTruncated: options.onToolResultTruncated,
      rejectClientToolCalls: options.rejectClientToolCalls,
      onSuspend: options.onSuspend,
    });
  }

  /**
   * Start a session and run its first trigger in a single streaming request.
   *
   * No server-side session exists until the first `execute({ type: 'trigger' })`;
   * that call creates the session (capturing `input` at that moment), runs the
   * trigger, and streams the result. The created session id is delivered via
   * `onSessionCreated` and on the first `start` event. After the first trigger
   * the handle behaves exactly like one returned from `attach()`.
   *
   * Use this to avoid a wasted pre-created session and to capture per-session
   * configuration (model, system-prompt inputs) at the first message rather than
   * ahead of time.
   */
  start(options: StartSessionOptions): AgentSession {
    return new AgentSession({
      config: this.config,
      deferredStart: {
        agentId: options.agentId,
        input: options.input,
        idempotencyKey: options.idempotencyKey,
        onSessionCreated: options.onSessionCreated,
      },
      tools: options.tools,
      mcpServers: options.mcpServers,
      onToolResults: options.onToolResults,
      onToolResultTruncated: options.onToolResultTruncated,
      rejectClientToolCalls: options.rejectClientToolCalls,
      onSuspend: options.onSuspend,
    });
  }
}
