import { z } from 'zod';
import { uiMessageSchema, type FileReference, type UIMessage } from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';

/**
 * Status of a Workforce thread (one dispatched run lives on the thread's
 * status). Terminal statuses are `completed`, `failed`, and `cancelled`.
 */
export type WorkforceThreadStatus =
  | 'idle'
  | 'queued'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

const TERMINAL_STATUSES: ReadonlySet<WorkforceThreadStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/** Whether a thread status is terminal (the run has finished). */
export function isTerminalThreadStatus(status: WorkforceThreadStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Status is validated leniently (any string) so a newly-added platform status
 * never breaks polling; unknown values are simply treated as non-terminal.
 */
const threadStatusSchema = z.string().transform((s) => s as WorkforceThreadStatus);

const dispatchResponseSchema = z.object({
  threadId: z.string(),
  status: threadStatusSchema,
});

const threadResponseSchema = z.object({
  threadId: z.string(),
  status: threadStatusSchema,
  failureReason: z.string().nullable(),
  messages: z.array(uiMessageSchema),
});

export interface WorkforceDispatchResult {
  threadId: string;
  status: WorkforceThreadStatus;
}

export interface WorkforceThread {
  threadId: string;
  status: WorkforceThreadStatus;
  /** A human-readable reason when the run ended in `failed`; null otherwise. */
  failureReason: string | null;
  /** The thread's UI messages (the conversation a user would see). */
  messages: UIMessage[];
}

export interface WorkforceDispatchOptions {
  /** File attachments to include with the message. */
  files?: FileReference[];
}

export interface WorkforceWaitOptions {
  /** Milliseconds between status polls. Default: 3000. */
  pollIntervalMs?: number;
  /**
   * Max time to wait for a terminal status before throwing. Environments vary:
   * cloud computers have cold-resume latency and full runs take minutes, so
   * size this generously. Default: 900000 (15 minutes).
   */
  timeoutMs?: number;
  /** Abort the wait early. */
  signal?: AbortSignal;
}

export type WorkforceRunOptions = WorkforceDispatchOptions & WorkforceWaitOptions;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * Workforce Agents API - drive a single OctoAgent ("Workforce Agent") headlessly
 * with a per-agent key (`oct_agt_*`). Construct the client with that key:
 *
 * ```ts
 * const client = new OctavusClient({ baseUrl, apiKey: 'oct_agt_...' });
 * const thread = await client.workforce.run(agentId, 'Summarize today\'s sales');
 * console.log(thread.status, thread.messages);
 * ```
 *
 * The key only authorizes its own agent: `dispatch` starts a thread, `getThread`
 * reads status + messages, `followUp` continues a thread, and `run` does the
 * whole create-wait-return cycle.
 */
export class WorkforceApi extends BaseApiClient {
  /** Start a new thread and dispatch the first message. Returns immediately. */
  async dispatch(
    agentId: string,
    message: string,
    options: WorkforceDispatchOptions = {},
  ): Promise<WorkforceDispatchResult> {
    return await this.httpPost(
      `/api/v1/workforce/agents/${encodeURIComponent(agentId)}/threads`,
      { message, files: options.files },
      dispatchResponseSchema,
    );
  }

  /** Read a thread's current status, failure reason, and UI messages. */
  async getThread(agentId: string, threadId: string): Promise<WorkforceThread> {
    return await this.httpGet(
      `/api/v1/workforce/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`,
      threadResponseSchema,
    );
  }

  /**
   * Send a follow-up message into an existing thread (sequential continuation).
   * If a run is in flight it queues and runs after; otherwise it dispatches now.
   */
  async followUp(
    agentId: string,
    threadId: string,
    message: string,
    options: WorkforceDispatchOptions = {},
  ): Promise<WorkforceDispatchResult> {
    return await this.httpPost(
      `/api/v1/workforce/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/messages`,
      { message, files: options.files },
      dispatchResponseSchema,
    );
  }

  /**
   * Poll a thread until it reaches a terminal status, then return it. Throws if
   * the timeout elapses first (the thread keeps running server-side and can be
   * read later with `getThread`).
   */
  async waitForCompletion(
    agentId: string,
    threadId: string,
    options: WorkforceWaitOptions = {},
  ): Promise<WorkforceThread> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const thread = await this.getThread(agentId, threadId);
      if (isTerminalThreadStatus(thread.status)) {
        return thread;
      }
      if (Date.now() + pollIntervalMs >= deadline) {
        throw new Error(
          `Workforce thread ${threadId} did not finish within ${timeoutMs}ms (last status: ${thread.status})`,
        );
      }
      await delay(pollIntervalMs, options.signal);
    }
  }

  /**
   * Dispatch a message and wait for the run to finish - the all-in-one method
   * for automating an agent. Returns the completed thread (the agent's latest
   * turn is the tail of `messages`).
   */
  async run(
    agentId: string,
    message: string,
    options: WorkforceRunOptions = {},
  ): Promise<WorkforceThread> {
    const { threadId } = await this.dispatch(agentId, message, { files: options.files });
    return await this.waitForCompletion(agentId, threadId, options);
  }
}

/** Resolve after `ms`, or reject early if the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(toAbortError(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function toAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason as unknown;
  return reason instanceof Error ? reason : new Error('The wait was aborted');
}
