import { OctavusError, type OctavusErrorOptions } from '@octavus/core';

export interface WorkerErrorOptions extends OctavusErrorOptions {
  /** The execution's id, when the worker started before failing (for its activity URL). */
  executionId?: string;
}

/**
 * Error thrown when a worker execution fails: an `OctavusError` (the error
 * guards and `requestId` apply) that also names the execution it failed in.
 */
export class WorkerError extends OctavusError {
  /** The execution's id, when the worker started before failing (for its activity URL). */
  readonly executionId?: string;

  constructor(options: WorkerErrorOptions) {
    super(options);
    this.name = 'WorkerError';
    this.executionId = options.executionId;
  }
}
