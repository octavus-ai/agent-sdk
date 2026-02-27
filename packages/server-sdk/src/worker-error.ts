/** Error thrown when a worker execution fails */
export class WorkerError extends Error {
  constructor(
    message: string,
    /** Session ID if the worker started before failing (for debugging URLs) */
    public readonly sessionId?: string,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}
