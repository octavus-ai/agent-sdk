import type { StreamEvent, ToolHandlers, ToolResult } from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { executeStream } from '@/streaming.js';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new worker execution */
export interface WorkerStartRequest {
  type: 'start';
  input: Record<string, unknown>;
}

/** Continue execution after client-side tool handling */
export interface WorkerContinueRequest {
  type: 'continue';
  executionId: string;
  toolResults: ToolResult[];
}

/** All request types supported by workers */
export type WorkerRequest = WorkerStartRequest | WorkerContinueRequest;

// =============================================================================
// Execution Options
// =============================================================================

/** Options for worker execution */
export interface WorkerExecuteOptions {
  /** Tool handlers for server-side tool execution */
  tools?: ToolHandlers;
  /** Abort signal to cancel the execution */
  signal?: AbortSignal;
}

// =============================================================================
// Workers API
// =============================================================================

/** API for executing worker agents */
export class WorkersApi extends BaseApiClient {
  /**
   * Execute a worker agent and stream the response.
   *
   * Worker agents execute steps sequentially and return an output value.
   * Unlike interactive sessions, workers don't maintain persistent state.
   *
   * The execution handles the tool continuation pattern automatically:
   * - Server tools (with handlers provided) are executed automatically
   * - Client tools (without handlers) emit a client-tool-request event
   *
   * @param agentId - The worker agent ID
   * @param input - Input values for the worker
   * @param options - Optional configuration including tools and abort signal
   * @returns An async generator of stream events
   *
   * @example Basic execution
   * ```typescript
   * const events = client.workers.execute(agentId, { TOPIC: 'AI safety' });
   * for await (const event of events) {
   *   if (event.type === 'worker-start') {
   *     console.log(`Worker ${event.workerSlug} started (${event.workerId})`);
   *   }
   *   if (event.type === 'worker-result') {
   *     if (event.error) {
   *       console.error('Worker failed:', event.error);
   *     } else {
   *       console.log('Output:', event.output);
   *     }
   *   }
   * }
   * ```
   *
   * @example With tool handlers
   * ```typescript
   * const events = client.workers.execute(agentId, { TOPIC: 'AI safety' }, {
   *   tools: {
   *     'web-search': async (args) => {
   *       return await searchWeb(args.query);
   *     },
   *   },
   * });
   * ```
   */
  async *execute(
    agentId: string,
    input: Record<string, unknown>,
    options: WorkerExecuteOptions = {},
  ): AsyncGenerator<StreamEvent> {
    yield* executeStream(
      {
        config: this.config,
        toolHandlers: options.tools ?? {},
        url: `${this.config.baseUrl}/api/agents/${agentId}/execute`,
        buildBody: ({ executionId, toolResults }) =>
          !executionId ? { type: 'start', input } : { type: 'continue', executionId, toolResults },
        errorContext: 'Failed to execute worker',
      },
      {},
      options.signal,
    );
  }

  /**
   * Continue a worker execution after client-side tool handling.
   *
   * Use this when your worker has tools without server-side handlers.
   * The execution returns a client-tool-request event with an executionId.
   * Execute the tools client-side, then call this method to continue.
   *
   * @param agentId - The worker agent ID
   * @param executionId - The execution ID from the client-tool-request event
   * @param toolResults - Results from client-side tool execution
   * @param options - Optional configuration including tools and abort signal
   * @returns An async generator of stream events
   *
   * @example
   * ```typescript
   * // Start execution
   * for await (const event of client.workers.execute(agentId, input)) {
   *   if (event.type === 'client-tool-request') {
   *     // Execute tools client-side
   *     const results = await executeToolsClientSide(event.toolCalls);
   *     // Continue execution
   *     for await (const ev of client.workers.continue(agentId, event.executionId, results)) {
   *       // Handle remaining events
   *     }
   *   }
   * }
   * ```
   */
  async *continue(
    agentId: string,
    executionId: string,
    toolResults: ToolResult[],
    options: WorkerExecuteOptions = {},
  ): AsyncGenerator<StreamEvent> {
    yield* executeStream(
      {
        config: this.config,
        toolHandlers: options.tools ?? {},
        url: `${this.config.baseUrl}/api/agents/${agentId}/execute`,
        buildBody: ({ executionId: execId, toolResults: results }) => ({
          type: 'continue',
          executionId: execId ?? executionId,
          toolResults: results ?? toolResults,
        }),
        errorContext: 'Failed to continue worker',
      },
      { executionId, toolResults },
      options.signal,
    );
  }
}
