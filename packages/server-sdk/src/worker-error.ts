import { OctavusError, type OctavusErrorOptions } from '@octavus/core';

export interface WorkerErrorOptions extends OctavusErrorOptions {
  /** Session ID if the worker started before failing (for debugging URLs) */
  sessionId?: string;
}

/**
 * Error thrown when a worker execution fails: an `OctavusError` (the error
 * guards and `requestId` apply) that also names the session it failed in.
 */
export class WorkerError extends OctavusError {
  /** Session ID if the worker started before failing (for debugging URLs) */
  readonly sessionId?: string;

  constructor(options: WorkerErrorOptions) {
    super(options);
    this.name = 'WorkerError';
    this.sessionId = options.sessionId;
  }
}
