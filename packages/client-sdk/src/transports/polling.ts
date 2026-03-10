import type { StreamEvent } from '@octavus/core';
import type { Transport } from './types';

// =============================================================================
// Polling Transport Types
// =============================================================================

export interface PollResult {
  events: unknown[];
  cursor: number;
  status: 'idle' | 'streaming' | 'error';
}

/**
 * Options for creating a polling transport.
 */
export interface PollingTransportOptions {
  /**
   * Dispatch a trigger to the backend.
   * Called when `send()` initiates a new execution.
   * Return `{ error }` to surface the error to the chat.
   */
  onTrigger: (triggerName: string, input?: Record<string, unknown>) => Promise<{ error?: string }>;

  /**
   * Poll for execution events.
   * Called repeatedly during streaming at `pollIntervalMs` intervals.
   * The cursor tracks read position — pass 0 on first call.
   */
  onPoll: (cursor: number) => Promise<PollResult>;

  /** Called when the user stops the execution. */
  onStop: () => void;

  /** Milliseconds between poll calls. Defaults to 500. */
  pollIntervalMs?: number;
}

// =============================================================================
// Transport Implementation
// =============================================================================

const DEFAULT_POLL_INTERVAL_MS = 500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Create a polling transport for backends that use a poll-based event delivery
 * model instead of SSE or WebSocket streaming.
 *
 * The transport dispatches a trigger via `onTrigger`, then polls `onPoll` at
 * a fixed interval, yielding events as they arrive. From `OctavusChat`'s
 * perspective this looks identical to an SSE stream.
 *
 * Supports `observe()` for resuming observation of an already-active execution
 * (e.g., after a page refresh while the agent is streaming). `observe()` skips
 * the trigger and goes straight to polling.
 *
 * @example
 * ```typescript
 * const transport = createPollingTransport({
 *   onTrigger: (triggerName, input) => triggerServerAction(input?.USER_MESSAGE),
 *   onPoll: (cursor) => pollServerAction(cursor),
 *   onStop: () => stopServerAction(),
 * });
 *
 * const { send, messages } = useOctavusChat({ transport });
 * ```
 */
export function createPollingTransport(options: PollingTransportOptions): Transport {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let abortController: AbortController | null = null;

  function startPolling(): AbortSignal {
    abortController?.abort();
    abortController = new AbortController();
    return abortController.signal;
  }

  async function* pollLoop(signal: AbortSignal): AsyncGenerator<StreamEvent> {
    let cursor = 0;

    while (!signal.aborted) {
      const result = await options.onPoll(cursor);
      if (signal.aborted) break;

      cursor = result.cursor;

      for (const event of result.events) {
        yield event as StreamEvent;
      }

      if (
        result.status === 'error' &&
        !result.events.some(
          (event) =>
            typeof event === 'object' &&
            event !== null &&
            'type' in event &&
            event.type === 'error',
        )
      ) {
        throw new Error('Execution failed');
      }

      if (result.status !== 'streaming') break;

      await sleep(pollIntervalMs, signal);
    }
  }

  return {
    async *trigger(triggerName, input) {
      const signal = startPolling();

      const result = await options.onTrigger(triggerName, input);
      if (result.error) throw new Error(result.error);

      if (signal.aborted) return;
      yield* pollLoop(signal);
    },

    // eslint-disable-next-line require-yield, @typescript-eslint/require-await
    async *continueWithToolResults() {
      throw new Error('continueWithToolResults is not supported by polling transport');
    },

    async *observe() {
      yield* pollLoop(startPolling());
    },

    stop() {
      abortController?.abort();
      abortController = null;
      options.onStop();
    },
  };
}
