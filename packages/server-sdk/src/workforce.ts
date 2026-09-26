import { z } from 'zod';
import { uiMessageSchema, type FileReference, type UIMessage } from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';

/**
 * Status of a Workforce thread (one dispatched run lives on the thread's
 * status). Terminal statuses are `completed`, `failed`, `cancelled`, and
 * `blocked` - an expected billing/usage stop where the run could not proceed
 * because an allowance, trial pool, budget, or spending limit was reached. A
 * `blocked` thread carries a `failureReason` explaining it and is recoverable: a
 * new dispatch after resolving billing runs the thread normally.
 */
export type WorkforceThreadStatus =
  | 'idle'
  | 'queued'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

const TERMINAL_STATUSES: ReadonlySet<WorkforceThreadStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

/** Whether a thread status is terminal (the run has finished). */
export function isTerminalThreadStatus(status: WorkforceThreadStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const SETTLED_RECORDING_STATUSES: ReadonlySet<WorkforceRecording['status']> = new Set([
  'ready',
  'failed',
  'unavailable',
]);

/**
 * Whether a recording status is final (`ready`, `failed`, or `unavailable`).
 * Unknown values are treated as not final, like thread statuses.
 */
export function isSettledRecordingStatus(status: WorkforceRecording['status']): boolean {
  return SETTLED_RECORDING_STATUSES.has(status);
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

/** The effective per-run config a thread ran under (what the run actually used). */
const threadRunConfigSchema = z.object({
  model: z.string().optional(),
  backupModel: z.string().optional(),
  thinking: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
});

/** Per-run cost + token summary, readable with the agent key. */
const usageSummarySchema = z.object({
  currency: z.literal('USD'),
  costUsd: z.number(),
  totalFeeUsd: z.number(),
  byok: z.boolean(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

/** A thread's execution recording, when the run was recorded. */
const recordingSchema = z.object({
  status: z.string().transform((s) => s as WorkforceRecording['status']),
  visibility: z.string().transform((v) => v as WorkforceRecording['visibility']),
  url: z.string().nullable(),
  error: z.string().nullable(),
});

const threadResponseSchema = z.object({
  threadId: z.string(),
  status: threadStatusSchema,
  failureReason: z.string().nullable(),
  messages: z.array(uiMessageSchema),
  // Optional read fields; an older platform may omit them, so default to null.
  runConfig: threadRunConfigSchema.nullish().transform((v) => v ?? null),
  usage: usageSummarySchema.nullish().transform((v) => v ?? null),
  recording: recordingSchema.nullish().transform((v) => v ?? null),
});

/** Thinking/reasoning effort for a run. */
export type WorkforceThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'max';

/**
 * Per-run configuration for a Workforce run, applied when starting a new thread
 * (the same shape the Agent CLI sends). Every field is optional; omitted fields
 * inherit the agent's stored configuration. The server validates and bounds it -
 * an unknown model, a provider with no resolvable key, or an undeclared
 * capability is rejected with a clear error before the run starts.
 */
export interface WorkforceRunConfig {
  /** Primary model for the run, "provider/model-id" (e.g. "anthropic/claude-sonnet-5"). */
  model?: string;
  /** Backup model for the run, "provider/model-id". */
  backupModel?: string;
  /** Thinking/reasoning effort for the run. */
  thinking?: WorkforceThinkingEffort;
  /**
   * Per-capability toggles (slug -> enabled): `true` enables, `false` disables; a
   * capability not listed inherits the agent's stored setting. Bounded to the
   * capabilities the agent's protocol declares.
   */
  capabilities?: Record<string, boolean>;
  /** Record this run's execution view (working process + computer) to a shareable video. */
  record?: boolean;
  /** Where the recording is stored/served: 'private' (default) or 'public' (permanent URL). */
  recordVisibility?: 'private' | 'public';
}

export interface WorkforceDispatchResult {
  threadId: string;
  status: WorkforceThreadStatus;
}

/** The effective per-run config a thread ran under (what the run actually used). */
export interface WorkforceThreadRunConfig {
  /** Primary model, "provider/model-id". */
  model?: string;
  /** Backup model, "provider/model-id". */
  backupModel?: string;
  /** Thinking/reasoning effort. */
  thinking?: string;
  /** The capability toggles the run applied (slug -> enabled). */
  capabilities?: Record<string, boolean>;
}

/**
 * Per-run cost + token summary for a thread. `costUsd` is the model/provider
 * cost regardless of who paid (the charged fee on Octavus keys, or the would-be
 * cost on BYOK); `totalFeeUsd` is the usage-based fee (provider + bandwidth) and
 * excludes any time-based agent billing.
 */
export interface WorkforceUsageSummary {
  currency: 'USD';
  costUsd: number;
  totalFeeUsd: number;
  byok: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * A thread's execution recording (present when the run was recorded). It settles
 * after the run: a finished thread can still report `recording` or `processing`
 * for a few seconds while the video is uploaded.
 */
export interface WorkforceRecording {
  /**
   * Recording lifecycle: `requested` (the run has not started yet), `recording`,
   * `processing` (the run ended; the video is being uploaded), then one of the
   * final states `ready`, `failed`, or `unavailable` (it never started).
   */
  status: 'requested' | 'recording' | 'processing' | 'ready' | 'failed' | 'unavailable';
  /** `private` (played via a signed URL after authorization) or `public` (permanent URL). */
  visibility: 'private' | 'public';
  /** Playable URL once `ready`; null otherwise. */
  url: string | null;
  /** Human-readable reason when `failed` or `unavailable`; null otherwise. */
  error: string | null;
}

export interface WorkforceThread {
  threadId: string;
  status: WorkforceThreadStatus;
  /** A human-readable reason when the run ended in `failed` or `blocked`; null otherwise. */
  failureReason: string | null;
  /** The thread's UI messages (the conversation a user would see). */
  messages: UIMessage[];
  /** The effective per-run config the thread ran under; null for a run with no per-run config. */
  runConfig: WorkforceThreadRunConfig | null;
  /** Per-run cost + token summary (zeros until the run accrues spend); null only if the platform doesn't report usage. */
  usage: WorkforceUsageSummary | null;
  /** The thread's execution recording; null unless the run was recorded. */
  recording: WorkforceRecording | null;
}

export interface WorkforceDispatchOptions {
  /** File attachments to include with the message. */
  files?: FileReference[];
  /**
   * Per-run configuration applied when starting a new thread (model, backup
   * model, thinking, capability toggles, recording) - the same shape the Agent
   * CLI sends. A thread's run config is fixed at creation, so it is honored by
   * `dispatch` / `run` and not by `followUp`.
   */
  config?: WorkforceRunConfig;
}

/** Options for continuing an existing thread with a follow-up message. */
export interface WorkforceFollowUpOptions {
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
  /**
   * Once the run has finished, how long to keep polling for a recorded run's
   * recording to reach a final status (`ready`, `failed`, or `unavailable`). A
   * recording normally settles within seconds; if it has not by then, the thread
   * is returned with its recording still in progress (never an error). `0` returns
   * as soon as the run finishes. Default: 120000 (2 minutes).
   */
  recordingTimeoutMs?: number;
  /** Abort the wait early. */
  signal?: AbortSignal;
}

export type WorkforceRunOptions = WorkforceDispatchOptions & WorkforceWaitOptions;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_RECORDING_TIMEOUT_MS = 2 * 60 * 1_000;

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
 * reads status + messages, `followUp` continues a thread, `cancel` stops an
 * in-flight run, and `run` does the whole create-wait-return cycle.
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
      { message, files: options.files, config: options.config },
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
   * A thread's run config is fixed at creation, so `followUp` takes no config.
   */
  async followUp(
    agentId: string,
    threadId: string,
    message: string,
    options: WorkforceFollowUpOptions = {},
  ): Promise<WorkforceDispatchResult> {
    return await this.httpPost(
      `/api/v1/workforce/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/messages`,
      { message, files: options.files },
      dispatchResponseSchema,
    );
  }

  /**
   * Cancel a thread's in-flight run - the programmatic equivalent of the
   * dashboard Stop button. Signals the executor to abort so a run that has blown
   * its budget stops instead of running on unattended. Idempotent: a thread that
   * is already terminal (or never started) is left untouched. Returns the settled
   * status (`cancelled` once the run was in flight); the final state is readable
   * with `getThread`.
   */
  async cancel(agentId: string, threadId: string): Promise<WorkforceDispatchResult> {
    return await this.httpPost(
      `/api/v1/workforce/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/cancel`,
      {},
      dispatchResponseSchema,
    );
  }

  /**
   * Poll a thread until it reaches a terminal status, then return it. Throws if
   * the timeout elapses first (the thread keeps running server-side and can be
   * read later with `getThread`). A recorded run's recording settles shortly after
   * the run, so the wait continues (up to `recordingTimeoutMs`) until the recording
   * is final as well.
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
        return await this.waitForRecording(agentId, thread, pollIntervalMs, options);
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
   * turn is the tail of `messages`; a recorded run's recording is given
   * `recordingTimeoutMs` to settle, as in `waitForCompletion`).
   */
  async run(
    agentId: string,
    message: string,
    options: WorkforceRunOptions = {},
  ): Promise<WorkforceThread> {
    const { threadId } = await this.dispatch(agentId, message, {
      files: options.files,
      config: options.config,
    });
    return await this.waitForCompletion(agentId, threadId, options);
  }

  /**
   * Keep reading a finished thread until its recording is final, within the
   * budget. Always returns a finished read: if the thread starts another run
   * meanwhile (a follow-up), the last finished read is returned.
   */
  private async waitForRecording(
    agentId: string,
    finished: WorkforceThread,
    pollIntervalMs: number,
    options: WorkforceWaitOptions,
  ): Promise<WorkforceThread> {
    const deadline = Date.now() + (options.recordingTimeoutMs ?? DEFAULT_RECORDING_TIMEOUT_MS);
    let thread = finished;
    while (
      thread.recording &&
      !isSettledRecordingStatus(thread.recording.status) &&
      Date.now() + pollIntervalMs < deadline
    ) {
      await delay(pollIntervalMs, options.signal);
      const latest = await this.getThread(agentId, thread.threadId);
      if (!isTerminalThreadStatus(latest.status)) return thread;
      thread = latest;
    }
    return thread;
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
