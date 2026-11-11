import { OctavusError, type OctavusErrorOptions } from '@octavus/core';

export interface WorkerErrorOptions extends OctavusErrorOptions {
  /** The session the run was recorded as, when the worker started before failing. */
  sessionId?: string;
  /** @deprecated Use `sessionId`. */
  executionId?: string;
}

/**
 * Error thrown when a worker execution fails: an `OctavusError` (the error
 * guards and `requestId` apply) that also names the session the failed run
 * was recorded as.
 */
export class WorkerError extends OctavusError {
  /**
   * The session the run was recorded as, when the worker started before
   * failing: `getSessionUrl()` turns it into the run's activity page.
   */
  readonly sessionId?: string;

  constructor(options: WorkerErrorOptions) {
    super(options);
    this.name = 'WorkerError';
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- accepts the deprecated option it replaces
    this.sessionId = options.sessionId ?? options.executionId;
  }

  /** @deprecated Use `sessionId`, which holds the same id. */
  get executionId(): string | undefined {
    return this.sessionId;
  }
}
