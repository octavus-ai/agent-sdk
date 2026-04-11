import { z } from 'zod';
import {
  chatMessageSchema,
  uiMessageSchema,
  type ChatMessage,
  type ToolHandlers,
  type ToolResult,
  type UIMessage,
} from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { throwApiError } from '@/api-error.js';
import { AgentSession } from '@/session.js';
import type { Resource } from '@/resource.js';

const createSessionResponseSchema = z.object({
  sessionId: z.string(),
});

const sessionStateSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  input: z.record(z.string(), z.unknown()),
  variables: z.record(z.string(), z.unknown()),
  resources: z.record(z.string(), z.unknown()),
  messages: z.array(chatMessageSchema),
  status: z.literal('active').optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const uiSessionResponseSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  messages: z.array(uiMessageSchema),
  status: z.literal('active').optional(),
});

const expiredSessionResponseSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.literal('expired'),
  createdAt: z.string(),
});

const restoreSessionResponseSchema = z.object({
  sessionId: z.string(),
  restored: z.boolean(),
});

const clearSessionResponseSchema = z.object({
  sessionId: z.string(),
  cleared: z.boolean(),
});

/** Session status indicating whether it's active or expired */
export type SessionStatus = 'active' | 'expired';

export interface SessionState {
  id: string;
  agentId: string;
  input: Record<string, unknown>;
  variables: Record<string, unknown>;
  resources: Record<string, unknown>;
  messages: ChatMessage[];
  status?: 'active';
  createdAt: string;
  updatedAt: string;
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

export interface SessionAttachOptions {
  tools?: ToolHandlers;
  resources?: Resource[];
  /** Called after server-side tools execute, before yielding events or continuing. Use to normalize tool results (e.g., upload base64 images). */
  onToolResults?: (results: ToolResult[]) => Promise<void>;
  /** When true, unhandled tool calls return errors instead of being emitted as client-tool-request events. */
  rejectClientToolCalls?: boolean;
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
   * Get full session state (for internal/debug use)
   * Note: Contains all messages including hidden content
   *
   * Returns SessionState for active sessions, ExpiredSessionState for expired sessions.
   * Check `status` field to determine which type was returned.
   */
  async get(sessionId: string): Promise<SessionState | ExpiredSessionState> {
    const response = await fetch(`${this.config.baseUrl}/api/agent-sessions/${sessionId}`, {
      method: 'GET',
      headers: this.config.getHeaders(),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();

    const expiredResult = expiredSessionResponseSchema.safeParse(data);
    if (expiredResult.success) {
      return expiredResult.data;
    }

    return sessionStateSchema.parse(data);
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
        headers: this.config.getHeaders(),
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

  /** Attach to an existing session for triggering events */
  attach(sessionId: string, options: SessionAttachOptions = {}): AgentSession {
    return new AgentSession({
      sessionId,
      config: this.config,
      tools: options.tools,
      resources: options.resources,
      onToolResults: options.onToolResults,
      rejectClientToolCalls: options.rejectClientToolCalls,
    });
  }
}
