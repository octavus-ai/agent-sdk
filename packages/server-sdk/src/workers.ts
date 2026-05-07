import type {
  StreamEvent,
  ToolHandlers,
  ToolResult,
  ToolSchema,
  InlineMcpServer,
} from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { executeStream } from '@/streaming.js';
import { WorkerError } from '@/worker-error.js';
import { resolveMcpServers } from '@/resolve-mcp-servers.js';

// =============================================================================
// Request Types
// =============================================================================

/** Start a new worker execution */
export interface WorkerStartRequest {
  type: 'start';
  input: Record<string, unknown>;
  /** Tool schemas for runtime-discovered tools (device MCPs, etc.) */
  dynamicToolSchemas?: ToolSchema[];
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
// Execution Options & Results
// =============================================================================

/** Options for worker execution */
export interface WorkerExecuteOptions {
  /** Tool handlers for server-side tool execution */
  tools?: ToolHandlers;
  /** Abort signal to cancel the execution */
  signal?: AbortSignal;
  /** Tool schemas for runtime-discovered tools (device MCPs, etc.) */
  dynamicToolSchemas?: ToolSchema[];
  /** Inline MCP servers providing namespaced, typed tool groups */
  mcpServers?: InlineMcpServer[];
}

/** Result from a non-streaming worker execution via `generate()` */
export interface WorkerGenerateResult {
  /** The worker's output value */
  output: unknown;
  /** Session ID for the worker execution (usable for debugging/session URLs) */
  sessionId: string;
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
    const mcpServers = options.mcpServers;
    const resolved =
      mcpServers !== undefined && mcpServers.length > 0
        ? resolveMcpServers(mcpServers, options.tools, options.dynamicToolSchemas)
        : { toolHandlers: options.tools ?? {}, dynamicToolSchemas: options.dynamicToolSchemas };

    yield* executeStream(
      {
        config: this.config,
        getToolHandlers: () => resolved.toolHandlers,
        url: `${this.config.baseUrl}/api/agents/${agentId}/execute`,
        buildBody: ({ executionId, toolResults }) =>
          !executionId
            ? {
                type: 'start',
                input,
                ...(resolved.dynamicToolSchemas !== undefined && {
                  dynamicToolSchemas: resolved.dynamicToolSchemas,
                }),
              }
            : { type: 'continue', executionId, toolResults },
        errorContext: 'Failed to execute worker',
      },
      {},
      options.signal,
    );
  }

  /**
   * Execute a worker agent and return the final output.
   *
   * Non-streaming equivalent of `execute()` - runs the worker to completion
   * and returns the output value directly. Use this when you don't need to
   * observe intermediate streaming events.
   *
   * @param agentId - The worker agent ID
   * @param input - Input values for the worker
   * @param options - Optional configuration including tools and abort signal
   * @returns The worker output and session ID
   * @throws {WorkerError} If the worker fails or completes without output
   *
   * @example Basic usage
   * ```typescript
   * const { output, sessionId } = await client.workers.generate(agentId, {
   *   TOPIC: 'AI safety',
   * });
   * console.log(output);
   * console.log(`Debug: ${client.getSessionUrl(sessionId)}`);
   * ```
   *
   * @example With timeout
   * ```typescript
   * const { output } = await client.workers.generate(agentId, input, {
   *   signal: AbortSignal.timeout(120_000),
   * });
   * ```
   */
  async generate(
    agentId: string,
    input: Record<string, unknown>,
    options: WorkerExecuteOptions = {},
  ): Promise<WorkerGenerateResult> {
    let sessionId: string | undefined;

    for await (const event of this.execute(agentId, input, options)) {
      if (event.type === 'start' && event.executionId) {
        sessionId = event.executionId;
      } else if (event.type === 'error') {
        throw new WorkerError(event.message, sessionId);
      } else if (event.type === 'worker-result') {
        if (event.error) {
          throw new WorkerError(event.error, sessionId ?? event.workerId);
        }
        return {
          output: event.output,
          sessionId: sessionId ?? event.workerId,
        };
      }
    }

    throw new WorkerError('Worker completed without producing a result', sessionId);
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
    // `continue` only forwards results - dynamic tool schemas are sent on the
    // initial `start` request and never repeated, so we resolve handlers only.
    const mcpServers = options.mcpServers;
    const toolHandlers =
      mcpServers !== undefined && mcpServers.length > 0
        ? resolveMcpServers(mcpServers, options.tools).toolHandlers
        : (options.tools ?? {});

    yield* executeStream(
      {
        config: this.config,
        getToolHandlers: () => toolHandlers,
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
