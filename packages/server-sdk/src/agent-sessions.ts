import type {
  ExecutionLogEntry,
  InlineMcpServer,
  PendingToolCall,
  ToolHandlers,
  ToolResult,
  UIMessage,
} from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { throwApiError } from '@/api-error.js';
import { AgentSession } from '@/session.js';
import type { ToolResultTruncation } from '@/tool-result-size.js';
import {
  createSessionResponseSchema,
  sessionResponseSchema,
  uiSessionResponseSchema,
  expiredSessionResponseSchema,
  restoreSessionResponseSchema,
  clearSessionResponseSchema,
  executionLogsResponseSchema,
} from '@/agent-session-schemas.js';

/** Session status indicating whether it's active or expired */
export type SessionStatus = 'active' | 'expired';

/**
 * A session's metadata. `status` is `active` while the platform holds the
 * session's state and `expired` once that state has aged out or been cleared;
 * an expired session is restored from the messages you stored with `restore()`.
 */
export interface SessionInfo {
  id: string;
  agentId: string;
  status: SessionStatus;
  createdAt: string;
}

export interface UISessionState {
  sessionId: string;
  agentId: string;
  messages: UIMessage[];
  status?: 'active';
}

export interface ExpiredSessionState {
  sessionId: string;
  agentId: string;
  status: 'expired';
  createdAt: string;
}

export interface RestoreSessionResult {
  sessionId: string;
  /** True if session was restored from messages, false if already active */
  restored: boolean;
}

export interface ClearSessionResult {
  sessionId: string;
  cleared: boolean;
}

export interface GetLogsOptions {
  /**
   * Exclude model-request entries. These are lightweight markers by default,
   * but carry the full provider request payload when model request tracing
   * is enabled.
   */
  excludeModelRequests?: boolean;
}

export interface ExecutionLogsResult {
  sessionId: string;
  entries: ExecutionLogEntry[];
  /** Total number of entries available server-side. May exceed `entries.length` when the response was capped. */
  total?: number;
  /** True when the response was capped and only the most recent entries were returned. */
  truncated?: boolean;
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

/** API for managing agent sessions */
export class AgentSessionsApi extends BaseApiClient {
  /** Create a new session for an agent */
  async create(agentId: string, input?: Record<string, unknown>): Promise<string> {
    const response = await this.httpPost(
      '/api/agent-sessions',
      { agentId, input },
      createSessionResponseSchema,
    );
    return response.sessionId;
  }

  /**
   * Get a session's metadata: its agent, when it was created, and whether its
   * state is still `active` or has `expired`. Messages are read with
   * `getMessages()`.
   */
  async get(sessionId: string): Promise<SessionInfo> {
    const response = await fetch(`${this.config.baseUrl}/api/agent-sessions/${sessionId}`, {
      method: 'GET',
      headers: await this.config.getHeaders(),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data = sessionResponseSchema.parse(await response.json());
    return {
      id: data.id ?? data.sessionId ?? sessionId,
      agentId: data.agentId,
      status: data.status ?? 'active',
      createdAt: data.createdAt,
    };
  }

  /**
   * Get UI-ready session messages (for client display)
   * Returns only visible messages with hidden content filtered out.
   *
   * For expired sessions, returns status: 'expired' without messages.
   * Use restore() to restore from stored messages before continuing.
   */
  async getMessages(sessionId: string): Promise<UISessionState | ExpiredSessionState> {
    const response = await fetch(
      `${this.config.baseUrl}/api/agent-sessions/${sessionId}?format=ui`,
      {
        method: 'GET',
        headers: await this.config.getHeaders(),
      },
    );

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();

    const expiredResult = expiredSessionResponseSchema.safeParse(data);
    if (expiredResult.success) {
      return expiredResult.data;
    }

    return uiSessionResponseSchema.parse(data);
  }

  /**
   * Restore an expired session from stored messages.
   *
   * Use this to restore a session after its state has expired.
   * The consumer should have stored the UIMessage[] array from previous interactions.
   *
   * @param sessionId - The session ID to restore
   * @param messages - Previously stored UIMessage[] array
   * @param input - Optional session input for system prompt interpolation (same as create)
   * @returns { sessionId, restored: true } if restored, { sessionId, restored: false } if already active
   */
  async restore(
    sessionId: string,
    messages: UIMessage[],
    input?: Record<string, unknown>,
  ): Promise<RestoreSessionResult> {
    return await this.httpPost(
      `/api/agent-sessions/${sessionId}/restore`,
      { messages, input },
      restoreSessionResponseSchema,
    );
  }

  /**
   * Clear session state from the server.
   * The session will transition to 'expired' status and can be restored with restore().
   * Idempotent: succeeds even if state was already cleared/expired.
   */
  async clear(sessionId: string): Promise<ClearSessionResult> {
    return await this.httpDelete(`/api/agent-sessions/${sessionId}`, clearSessionResponseSchema);
  }

  /**
   * Get execution logs for a session.
   * Returns the chronological trace of everything that happened during execution.
   *
   * Entries are typed as `ExecutionLogEntry` (a discriminated union) for convenient
   * narrowing on `entry.type`. New entry types may be added server-side - include a
   * `default` case when switching on `type` to handle unknown variants gracefully.
   *
   * For expired sessions, returns status: 'expired' without entries.
   */
  async getLogs(
    sessionId: string,
    options?: GetLogsOptions,
  ): Promise<ExecutionLogsResult | ExpiredSessionState> {
    const params = new URLSearchParams();
    if (options?.excludeModelRequests) {
      params.set('excludeModelRequests', 'true');
    }

    const query = params.toString();
    const url = `${this.config.baseUrl}/api/agent-sessions/${sessionId}/logs${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: await this.config.getHeaders(),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();

    const expiredResult = expiredSessionResponseSchema.safeParse(data);
    if (expiredResult.success) {
      return expiredResult.data;
    }

    return executionLogsResponseSchema.parse(data) as ExecutionLogsResult;
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
