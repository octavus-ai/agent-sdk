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

/** A string the platform sends as null (or leaves out) once it no longer applies. */
const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const sessionSchema = z.looseObject({
  id: z.string(),
  agentId: z.string(),
  status: sessionStatusSchema,
  createdAt: z.string(),
  updatedAt: nullableString,
  expiresAt: nullableString,
  revision: nullableString,
});

const sessionWithMessagesSchema = sessionSchema.extend({
  messages: z.array(uiMessageSchema),
});

const sessionMessagesResponseSchema = z.looseObject({
  messages: z.array(uiMessageSchema),
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
export type SessionStatus = 'active' | 'expired';

/**
 * A session: its agent, when it was created, and whether its state is still
 * `active` or has `expired` (aged out or cleared). An expired session is
 * restored from the messages you stored with `restore()`.
 *
 * While the state is `active`, `revision` names its last write, `updatedAt`
 * says when that write happened, and `expiresAt` when the state ages out if
 * nothing writes it again (every execution moves it). All three are null once
 * the state has expired.
 */
export interface Session {
  id: string;
  agentId: string;
  status: SessionStatus;
  createdAt: string;
  /** When the session's state was last written. Null when expired. */
  updatedAt: string | null;
  /** When the session's state ages out if nothing writes it again. Null when expired. */
  expiresAt: string | null;
  /**
   * An opaque token of the state's last write. Equal revisions are the same
   * stored state, so a copy of the conversation stamped with a revision is
   * current while the session still reports it; a different revision means
   * the state was written since. Compare for equality only. Null when expired.
   */
  revision: string | null;
}

/**
 * The session with its conversation embedded: `messages` as `getMessages()`
 * returns them, read in the same snapshot as the session's `revision`. Empty
 * once the session's state has expired.
 */
export interface SessionWithMessages extends Session {
  messages: UIMessage[];
}

/**
 * What `restore()` rebuilds an expired session's state from: the conversation
 * you stored. The messages carry what their display modes revealed: a `stream`
 * tool call comes back with its arguments and result, a `title` call with
 * empty arguments and a placeholder result, and a `hidden` call not at all,
 * so set `display: stream` on the tools whose results the model should still
 * have after a restore.
 */
export interface SessionRestoreFromMessages {
  /** The stored `UIMessage[]`, as `get(sessionId, { includeMessages: true })` or `getMessages()` returned them. */
  messages: UIMessage[];
  /** The session input the system prompt is rebuilt with (the same input as `create()`). */
  input?: Record<string, unknown>;
}

/** What a `restore()` did. */
export interface SessionRestoreResult {
  /** The session, `active`: at the revision the restore wrote, or the live one it left as it was. */
  session: Session;
  /**
   * True when the state was rebuilt from what you sent (the session's
   * `revision` is the one the restore wrote, and the messages you sent are
   * that revision); false when the state was still live and was left as it
   * is (what you sent was not applied).
   */
  restored: boolean;
}

export interface GetSessionOptions {
  /**
   * Embed the conversation on the session (`SessionWithMessages`), read in
   * one snapshot with the session's `revision`.
   */
  includeMessages?: boolean;
}

export interface GetLogsOptions {
  /**
   * Exclude model-request entries. These are lightweight markers by default,
   * but carry the full provider request payload when model request tracing
   * is enabled.
   */
  excludeModelRequests?: boolean;
}

/** A session's execution log. */
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
   * Idempotency key, sent as the `Idempotency-Key` header of the request that
   * creates the session, so a transient retry of it resolves to the same
   * session instead of creating a duplicate. 1-255 printable ASCII characters
   * with no spaces; auto-generated if omitted.
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
   * Get a session: its agent, when it was created, whether its state is still
   * `active` or has `expired`, and while it is active its `revision`,
   * `updatedAt`, and `expiresAt`. With `includeMessages`, the conversation is
   * embedded as `messages`, read in the same snapshot as the `revision`: the
   * one read for a page load, since an expired session answers `expired` with
   * empty messages instead of throwing.
   */
  get(sessionId: string, options: { includeMessages: true }): Promise<SessionWithMessages>;
  get(sessionId: string, options?: GetSessionOptions): Promise<Session>;
  async get(
    sessionId: string,
    options: GetSessionOptions = {},
  ): Promise<Session | SessionWithMessages> {
    if (options.includeMessages) {
      return await this.httpGet(`/api/v1/sessions/${sessionId}`, sessionWithMessagesSchema, {
        include: 'messages',
      });
    }
    return await this.httpGet(`/api/v1/sessions/${sessionId}`, sessionSchema);
  }

  /**
   * Get the session's conversation as the UI renders it: the visible messages,
   * each part revealing what its display mode allows. Pass them to
   * `initialMessages` on the client, and store them to restore the session
   * later with `restore()`. The messages are the session's live
   * state: an expired session fails with the code `SESSION_EXPIRED`
   * (`SESSION_EXPIRED_CODE`), like any operation that needs the live state.
   * To read the session and its messages together whatever its status, use
   * `get(sessionId, { includeMessages: true })`.
   */
  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const { messages } = await this.httpGet(
      `/api/v1/sessions/${sessionId}/messages`,
      sessionMessagesResponseSchema,
    );
    return messages;
  }

  /**
   * Restore an expired session from what you stored, so the conversation
   * continues after the server-side state has expired. A session whose state
   * is still live is left as it is: a restore is never an error, so two
   * restores racing both succeed and a retry after a lost response is safe.
   *
   * @param sessionId - The session ID to restore
   * @param from - The stored conversation (`messages`) and the session `input`
   * @returns The session, `active`, and `restored`: true when its state was
   * rebuilt from what you sent, false when it was still live and left as it is
   */
  async restore(
    sessionId: string,
    from: SessionRestoreFromMessages,
  ): Promise<SessionRestoreResult> {
    const { status, data } = await this.httpPostWithStatus(
      `/api/v1/sessions/${sessionId}/restore`,
      { messages: from.messages, input: from.input },
      sessionSchema,
    );
    return { session: data, restored: status === 201 };
  }

  /**
   * Restore an expired session from the messages you stored.
   *
   * @deprecated Use `restore(sessionId, { messages, input })`, which also
   * reports whether the state was rebuilt.
   * @returns The session, `active` (a session that was still active is left as it is)
   */
  async restoreFromMessages(
    sessionId: string,
    messages: UIMessage[],
    input?: Record<string, unknown>,
  ): Promise<Session> {
    const { session } = await this.restore(sessionId, { messages, input });
    return session;
  }

  /**
   * Clear the session's state from the server. The session becomes `expired`
   * and can be restored with `restore()`. Idempotent: succeeds when the state
   * was already gone.
   */
  async clear(sessionId: string): Promise<Session> {
    return await this.httpPost(`/api/v1/sessions/${sessionId}/clear`, {}, sessionSchema);
  }

  /**
   * Get the session's execution log: the chronological trace of everything
   * that happened during execution.
   *
   * Entries are typed as `ExecutionLogEntry` (a discriminated union) for convenient
   * narrowing on `entry.type`. New entry types may be added server-side - include a
   * `default` case when switching on `type` to handle unknown variants gracefully.
   *
   * The log lives with the session's state: an expired session fails with the
   * code `SESSION_EXPIRED`.
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
