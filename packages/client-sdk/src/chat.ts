import {
  generateId,
  threadForPart,
  isFileReferenceArray,
  OctavusError,
  type UIMessage,
  type UIMessagePart,
  type UITextPart,
  type UIReasoningPart,
  type UIToolCallPart,
  type UIOperationPart,
  type UISourcePart,
  type UIFilePart,
  type UIObjectPart,
  type UIWorkerPart,
  type DisplayMode,
  type StreamEvent,
  type FileReference,
  type PendingToolCall,
  type ToolResult,
} from '@octavus/core';
import type { Transport } from './transports/types';
import { uploadFiles, type UploadFilesOptions } from './files';

/** Block types that are internal operations (not LLM-driven) */
const OPERATION_BLOCK_TYPES = new Set(['set-resource', 'serialize-thread', 'generate-image']);

// =============================================================================
// Types
// =============================================================================

export type ChatStatus = 'idle' | 'streaming' | 'error' | 'awaiting-input';

/**
 * Context provided to client tool handlers.
 */
export interface ClientToolContext {
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Name of the tool being called */
  toolName: string;
  /** Signal for cancellation if user stops generation */
  signal: AbortSignal;
}

/**
 * Handler function for client-side tool execution.
 * Can be:
 * - An async function that executes automatically and returns a result
 * - The string 'interactive' to indicate the tool requires user interaction
 */
export type ClientToolHandler =
  | ((args: Record<string, unknown>, ctx: ClientToolContext) => Promise<unknown>)
  | 'interactive';

/**
 * Interactive tool call awaiting user interaction.
 * The `submit` and `cancel` methods are pre-bound to this tool call's ID.
 */
export interface InteractiveTool {
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Name of the tool being called */
  toolName: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /**
   * Submit a result for this tool call.
   * Call this when the user has provided input.
   *
   * @param result - The result from user interaction
   */
  submit: (result: unknown) => void;
  /**
   * Cancel this tool call with an optional reason.
   * Call this when the user dismisses the UI without providing input.
   *
   * @param reason - Optional reason for cancellation (default: 'User cancelled')
   */
  cancel: (reason?: string) => void;
}

/**
 * Internal pending tool state (before binding submit/cancel).
 */
interface PendingToolState {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  source?: 'llm' | 'block';
  outputVariable?: string;
  blockIndex?: number;
  thread?: string;
}

/**
 * Input for creating a user message.
 * Supports text content, structured object content, and file attachments.
 */
export interface UserMessageInput {
  /**
   * Content of the message. Can be:
   * - string: Creates a text part
   * - object: Creates an object part (uses `type` field as typeName if present)
   */
  content?: string | Record<string, unknown>;
  /**
   * File attachments (shorthand). Can be:
   * - FileList: From file input element (will be uploaded via uploadFiles)
   * - File[]: Array of File objects (will be uploaded via uploadFiles)
   * - FileReference[]: Already uploaded files (used directly)
   */
  files?: FileList | File[] | FileReference[];
}

export interface OctavusChatOptions {
  /**
   * Transport for streaming events.
   * Use `createHttpTransport` for HTTP/SSE or `createSocketTransport` for WebSocket/SockJS.
   */
  transport: Transport;

  /**
   * Function to request upload URLs from the platform.
   * Required if you want to use file uploads with FileList/File[].
   *
   * @example
   * ```typescript
   * requestUploadUrls: async (files) => {
   *   const response = await fetch('/api/upload-urls', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ sessionId, files }),
   *   });
   *   return response.json();
   * }
   * ```
   */
  requestUploadUrls?: UploadFilesOptions['requestUploadUrls'];

  /**
   * Client-side tool handlers.
   * Register handlers for tools that should execute in the browser.
   *
   * - If a tool has a handler function: executes automatically
   * - If a tool is marked as 'interactive': appears in `pendingClientTools` with bound `submit()`/`cancel()`
   *
   * @example Automatic client tool
   * ```typescript
   * clientTools: {
   *   'get-browser-location': async () => {
   *     const pos = await new Promise((resolve, reject) => {
   *       navigator.geolocation.getCurrentPosition(resolve, reject);
   *     });
   *     return { lat: pos.coords.latitude, lng: pos.coords.longitude };
   *   },
   * }
   * ```
   *
   * @example Interactive client tool (user input required)
   * ```typescript
   * clientTools: {
   *   'request-feedback': 'interactive',
   * }
   * // Then render UI based on pendingClientTools['request-feedback']
   * // and call tool.submit(result) or tool.cancel()
   * ```
   */
  clientTools?: Record<string, ClientToolHandler>;

  /** Initial messages (for session refresh) */
  initialMessages?: UIMessage[];
  /**
   * Callback when an error occurs.
   * Receives an OctavusError with structured error information.
   *
   * @example
   * ```typescript
   * onError: (error) => {
   *   console.error('Chat error:', {
   *     type: error.errorType,
   *     message: error.message,
   *     retryable: error.retryable,
   *     provider: error.provider,
   *   });
   *
   *   // Handle specific error types
   *   if (isRateLimitError(error)) {
   *     showRetryButton(error.retryAfter);
   *   }
   * }
   * ```
   */
  onError?: (error: OctavusError) => void;
  /** Callback when streaming finishes successfully */
  onFinish?: () => void;
  /** Callback when streaming is stopped by user */
  onStop?: () => void;
  /** Callback when a resource is updated */
  onResourceUpdate?: (name: string, value: unknown) => void;
  /**
   * Callback when execution starts with the session/execution ID.
   * Useful for tracking the current execution for activity logs.
   *
   * @example
   * ```typescript
   * onStart: (sessionId) => {
   *   setCurrentSessionId(sessionId);
   * }
   * ```
   */
  onStart?: (sessionId: string) => void;
}

// =============================================================================
// Internal Types
// =============================================================================

interface BlockState {
  blockId: string;
  blockName: string;
  blockType: string;
  display: DisplayMode;
  description?: string;
  outputToChat: boolean;
  thread?: string;
  reasoning: string;
  text: string;
  toolCalls: Map<string, UIToolCallPart>;
}

/** Tracks state for a worker part being populated */
interface WorkerPartState {
  partIndex: number;
  currentTextPartIndex: number | null;
  currentReasoningPartIndex: number | null;
  currentObjectPartIndex: number | null;
  accumulatedJson: string;
}

interface StreamingState {
  messageId: string;
  parts: UIMessagePart[];
  activeBlock: BlockState | null;
  blocks: Map<string, BlockState>;
  currentTextPartIndex: number | null;
  currentReasoningPartIndex: number | null;
  currentObjectPartIndex: number | null;
  accumulatedJson: string;
  /** Active workers being populated: workerId -> worker state */
  activeWorkers: Map<string, WorkerPartState>;
}

type Listener = () => void;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a user message from input with optional file attachments.
 * Parts order: files first (for vision models), then content (text or object).
 */
function createUserMessage(input: UserMessageInput, files?: FileReference[]): UIMessage {
  const parts: UIMessagePart[] = [];

  // Add file parts first (vision models expect images before text)
  if (files && files.length > 0) {
    for (const file of files) {
      parts.push({
        type: 'file',
        id: file.id,
        mediaType: file.mediaType,
        url: file.url,
        filename: file.filename,
        size: file.size,
      });
    }
  }

  // Add content part after files
  if (input.content !== undefined) {
    if (typeof input.content === 'string') {
      // String content → text part
      parts.push({ type: 'text', text: input.content, status: 'done' });
    } else {
      // Object content → object part
      // Use the object's `type` field as typeName if present, otherwise fallback to 'object'
      const typeName = (input.content as { type?: string }).type ?? 'object';
      parts.push({
        type: 'object',
        id: generateId(),
        typeName,
        object: input.content,
        status: 'done',
      });
    }
  }

  return {
    id: generateId(),
    role: 'user',
    parts,
    status: 'done',
    createdAt: new Date(),
  };
}

/**
 * Parse partial JSON by fixing incomplete structures (unclosed strings, brackets, braces).
 */
function parsePartialJson(jsonText: string): unknown {
  if (!jsonText.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    // Continue to fix incomplete JSON
  }

  let fixed = jsonText;

  // Count unclosed brackets/braces while tracking string boundaries
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (const char of fixed) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') openBraces += 1;
      else if (char === '}') openBraces -= 1;
      else if (char === '[') openBrackets += 1;
      else if (char === ']') openBrackets -= 1;
    }
  }

  // Close unclosed structures
  if (inString) {
    fixed += '"';
  }
  while (openBrackets > 0) {
    fixed += ']';
    openBrackets -= 1;
  }
  while (openBraces > 0) {
    fixed += '}';
    openBraces -= 1;
  }

  try {
    return JSON.parse(fixed) as unknown;
  } catch {
    return undefined;
  }
}

function createEmptyStreamingState(): StreamingState {
  return {
    messageId: generateId(),
    parts: [],
    activeBlock: null,
    blocks: new Map(),
    currentTextPartIndex: null,
    currentReasoningPartIndex: null,
    currentObjectPartIndex: null,
    accumulatedJson: '',
    activeWorkers: new Map(),
  };
}

function buildMessageFromState(state: StreamingState, status: 'streaming' | 'done'): UIMessage {
  return {
    id: state.messageId,
    role: 'assistant',
    parts: [...state.parts],
    status,
    createdAt: new Date(),
  };
}

// =============================================================================
// OctavusChat Class
// =============================================================================

/**
 * Framework-agnostic chat client for Octavus agents.
 * Manages chat state and streaming, allowing reactive frameworks to subscribe to updates.
 *
 * @example HTTP transport (Next.js, etc.)
 * ```typescript
 * import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';
 *
 * const chat = new OctavusChat({
 *   transport: createHttpTransport({
 *     request: (payload, options) =>
 *       fetch('/api/trigger', {
 *         method: 'POST',
 *         headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify({ sessionId, ...payload }),
 *         signal: options?.signal,
 *       }),
 *   }),
 * });
 * ```
 *
 * @example Socket transport (WebSocket, SockJS, Meteor)
 * ```typescript
 * import { OctavusChat, createSocketTransport } from '@octavus/client-sdk';
 *
 * const chat = new OctavusChat({
 *   transport: createSocketTransport({
 *     connect: () => new Promise((resolve, reject) => {
 *       const ws = new WebSocket(`wss://api.octavus.ai/stream?sessionId=${sessionId}`);
 *       ws.onopen = () => resolve(ws);
 *       ws.onerror = () => reject(new Error('Connection failed'));
 *     }),
 *   }),
 * });
 * ```
 */
export class OctavusChat {
  // Private state
  private _messages: UIMessage[];
  private _status: ChatStatus = 'idle';
  private _error: OctavusError | null = null;
  private options: OctavusChatOptions;
  private transport: Transport;
  private streamingState: StreamingState | null = null;

  // Client tool state
  // Keyed by toolName -> array of pending tools for that name
  private _pendingToolsByName = new Map<string, PendingToolState[]>();
  // Keyed by toolCallId -> pending tool state (for internal lookup when submitting)
  private _pendingToolsByCallId = new Map<string, PendingToolState>();
  // Cache for React useSyncExternalStore compatibility
  private _pendingClientToolsCache: Record<string, InteractiveTool[]> = {};
  private _completedToolResults: ToolResult[] = [];
  private _clientToolAbortController: AbortController | null = null;
  // Server tool results from mixed server+client tools (for continuation)
  private _serverToolResults: ToolResult[] = [];
  // Execution ID for continuation (from client-tool-request event)
  private _pendingExecutionId: string | null = null;
  // Flag indicating automatic client tools have completed and are ready to continue
  // We wait for the finish event before actually continuing to avoid race conditions
  private _readyToContinue = false;
  // Flag indicating the finish event with client-tool-calls reason has been received
  // Used to handle the race condition where finish arrives before async tools complete
  private _finishEventReceived = false;

  // Listener sets for reactive frameworks
  private listeners = new Set<Listener>();

  constructor(options: OctavusChatOptions) {
    this.options = options;
    this._messages = options.initialMessages ?? [];
    this.transport = options.transport;
  }

  // =========================================================================
  // Public Getters
  // =========================================================================

  get messages(): UIMessage[] {
    return this._messages;
  }

  get status(): ChatStatus {
    return this._status;
  }

  /**
   * The current error, if any.
   * Contains structured error information including type, source, and retryability.
   */
  get error(): OctavusError | null {
    return this._error;
  }

  /**
   * Pending interactive tool calls keyed by tool name.
   * Each tool has bound `submit()` and `cancel()` methods.
   *
   * @example
   * ```tsx
   * const feedbackTools = pendingClientTools['request-feedback'] ?? [];
   *
   * {feedbackTools.map(tool => (
   *   <FeedbackModal
   *     key={tool.toolCallId}
   *     {...tool.args}
   *     onSubmit={(result) => tool.submit(result)}
   *     onCancel={() => tool.cancel()}
   *   />
   * ))}
   * ```
   */
  get pendingClientTools(): Record<string, InteractiveTool[]> {
    return this._pendingClientToolsCache;
  }

  // =========================================================================
  // Subscription Methods (for reactive frameworks)
  // =========================================================================

  /**
   * Subscribe to state changes. The callback is called whenever messages, status, or error changes.
   * @returns Unsubscribe function
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  // =========================================================================
  // Private Setters (notify listeners)
  // =========================================================================

  private setMessages(messages: UIMessage[]): void {
    this._messages = messages;
    this.notifyListeners();
  }

  private setStatus(status: ChatStatus): void {
    this._status = status;
    this.notifyListeners();
  }

  private setError(error: OctavusError | null): void {
    this._error = error;
    this.notifyListeners();
  }

  private updatePendingClientToolsCache(): void {
    const cache: Record<string, InteractiveTool[]> = {};
    for (const [toolName, tools] of this._pendingToolsByName.entries()) {
      cache[toolName] = tools.map((tool) => ({
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        args: tool.args,
        submit: (result: unknown) => this.submitToolResult(tool.toolCallId, result),
        cancel: (reason?: string) =>
          this.submitToolResult(tool.toolCallId, undefined, reason ?? 'User cancelled'),
      }));
    }
    this._pendingClientToolsCache = cache;
  }

  // =========================================================================
  // Public Methods
  // =========================================================================

  /**
   * Trigger the agent and optionally add a user message to the chat.
   *
   * @param triggerName - The trigger name defined in the agent's protocol.yaml
   * @param input - Input parameters for the trigger (variable substitutions)
   * @param options.userMessage - If provided, adds a user message to the chat before triggering
   *
   * @example Send a text message
   * ```typescript
   * await chat.send('user-message',
   *   { USER_MESSAGE: message },
   *   { userMessage: { content: message } }
   * );
   * ```
   *
   * @example Send a message with file attachments
   * ```typescript
   * await chat.send('user-message',
   *   { USER_MESSAGE: message, FILES: fileRefs },
   *   { userMessage: { content: message, files: fileRefs } }
   * );
   * ```
   */
  async send(
    triggerName: string,
    input?: Record<string, unknown>,
    sendOptions?: { userMessage?: UserMessageInput },
  ): Promise<void> {
    this.transport.stop();

    let fileRefs: FileReference[] | undefined;
    if (sendOptions?.userMessage?.files) {
      const files = sendOptions.userMessage.files;
      if (isFileReferenceArray(files)) {
        fileRefs = files;
      } else if (this.options.requestUploadUrls) {
        fileRefs = await uploadFiles(files, {
          requestUploadUrls: this.options.requestUploadUrls,
        });
      } else {
        throw new Error(
          'File upload requires requestUploadUrls option. Either provide FileReference[] or configure requestUploadUrls.',
        );
      }
    }

    // Auto-upload FILES in trigger input if needed
    let processedInput = input;
    if (input?.FILES !== undefined && !isFileReferenceArray(input.FILES)) {
      if (this.options.requestUploadUrls) {
        const inputFiles = input.FILES as FileList | File[];
        const uploadedRefs =
          fileRefs ??
          (await uploadFiles(inputFiles, {
            requestUploadUrls: this.options.requestUploadUrls,
          }));
        processedInput = { ...input, FILES: uploadedRefs };
        fileRefs = fileRefs ?? uploadedRefs;
      }
    }

    // Optimistic UI: add user message before server responds
    if (sendOptions?.userMessage !== undefined) {
      const userMsg = createUserMessage(sendOptions.userMessage, fileRefs);
      this.setMessages([...this._messages, userMsg]);
    }

    this.setStatus('streaming');
    this.setError(null);
    this.streamingState = createEmptyStreamingState();

    // Clear any previous client tool state
    this._pendingToolsByName.clear();
    this._pendingToolsByCallId.clear();
    this._completedToolResults = [];
    this._serverToolResults = [];
    this._pendingExecutionId = null;
    this._readyToContinue = false;
    this._finishEventReceived = false;
    this.updatePendingClientToolsCache();

    try {
      for await (const event of this.transport.trigger(triggerName, processedInput)) {
        if (this.streamingState === null) break;

        this.handleStreamEvent(event, this.streamingState);
      }
    } catch (err) {
      // Convert unknown errors to OctavusError
      const errorObj = OctavusError.isInstance(err)
        ? err
        : new OctavusError({
            errorType: 'internal_error',
            message: err instanceof Error ? err.message : 'Unknown error',
            source: 'client',
            retryable: false,
            cause: err,
          });

      // Finalize any streaming message before setting error state
      const state = this.streamingState;
      if (state !== null) {
        const messages = [...this._messages];
        const lastMsg = messages[messages.length - 1];

        if (state.parts.length > 0) {
          // Mark in-progress parts as done/cancelled
          const finalParts = state.parts.map((part): UIMessagePart => {
            if (part.type === 'text' || part.type === 'reasoning') {
              if (part.status === 'streaming') {
                return { ...part, status: 'done' };
              }
            }
            if (part.type === 'object' && part.status === 'streaming') {
              return { ...part, status: 'done' };
            }
            if (part.type === 'tool-call') {
              if (part.status === 'pending' || part.status === 'running') {
                return { ...part, status: 'cancelled' };
              }
            }
            if (part.type === 'operation' && part.status === 'running') {
              return { ...part, status: 'cancelled' };
            }
            return part;
          });

          const finalMessage: UIMessage = {
            id: state.messageId,
            role: 'assistant',
            parts: finalParts,
            status: 'done',
            createdAt: new Date(),
          };

          if (lastMsg?.id === state.messageId) {
            messages[messages.length - 1] = finalMessage;
          } else {
            messages.push(finalMessage);
          }
          this.setMessages(messages);
        } else if (lastMsg?.id === state.messageId) {
          // No parts yet - remove the empty streaming message
          messages.pop();
          this.setMessages(messages);
        }
      }

      this.setError(errorObj);
      this.setStatus('error');
      this.streamingState = null;
      this.options.onError?.(errorObj);
    }
  }

  /**
   * Upload files directly without sending a message.
   * Useful for showing upload progress before sending.
   *
   * @param files - Files to upload
   * @param onProgress - Optional progress callback
   * @returns Array of file references
   *
   * @example
   * ```typescript
   * const fileRefs = await chat.uploadFiles(fileInput.files, (i, progress) => {
   *   console.log(`File ${i}: ${progress}%`);
   * });
   * // Later...
   * await chat.send('user-message', { FILES: fileRefs }, { userMessage: { files: fileRefs } });
   * ```
   */
  async uploadFiles(
    files: FileList | File[],
    onProgress?: (fileIndex: number, progress: number) => void,
  ): Promise<FileReference[]> {
    if (!this.options.requestUploadUrls) {
      throw new Error('File upload requires requestUploadUrls option');
    }
    return await uploadFiles(files, {
      requestUploadUrls: this.options.requestUploadUrls,
      onProgress,
    });
  }

  /**
   * Internal: Submit a result for a pending tool.
   * Called by bound submit/cancel methods on InteractiveTool.
   */
  private submitToolResult(toolCallId: string, result?: unknown, error?: string): void {
    const pendingTool = this._pendingToolsByCallId.get(toolCallId);
    if (!pendingTool) {
      // Tool not found - may have been cancelled or already resolved
      return;
    }

    // Remove from both maps
    this._pendingToolsByCallId.delete(toolCallId);
    const toolsForName = this._pendingToolsByName.get(pendingTool.toolName);
    if (toolsForName) {
      const filtered = toolsForName.filter((t) => t.toolCallId !== toolCallId);
      if (filtered.length === 0) {
        this._pendingToolsByName.delete(pendingTool.toolName);
      } else {
        this._pendingToolsByName.set(pendingTool.toolName, filtered);
      }
    }
    this.updatePendingClientToolsCache();

    const toolResult: ToolResult = {
      toolCallId,
      toolName: pendingTool.toolName,
      result: error ? undefined : result,
      error,
      outputVariable: pendingTool.outputVariable,
      blockIndex: pendingTool.blockIndex,
      thread: pendingTool.thread,
    };
    this._completedToolResults.push(toolResult);

    if (error) {
      this.emitToolOutputError(toolCallId, error);
    } else {
      this.emitToolOutputAvailable(toolCallId, result);
    }

    if (this._pendingToolsByCallId.size === 0) {
      void this.continueWithClientToolResults();
    }

    this.notifyListeners();
  }

  /** Stop the current streaming and finalize any partial message */
  stop(): void {
    if (this._status !== 'streaming' && this._status !== 'awaiting-input') {
      return;
    }

    this._clientToolAbortController?.abort();
    this._clientToolAbortController = null;
    this._pendingToolsByName.clear();
    this._pendingToolsByCallId.clear();
    this._completedToolResults = [];
    this._serverToolResults = [];
    this._pendingExecutionId = null;
    this._readyToContinue = false;
    this._finishEventReceived = false;
    this.updatePendingClientToolsCache();

    this.transport.stop();

    const state = this.streamingState;
    if (state && state.parts.length > 0) {
      // Mark in-progress parts as cancelled/done
      const finalParts = state.parts.map((part): UIMessagePart => {
        if (part.type === 'tool-call') {
          const toolPart = part;
          // Mark pending/running tools as cancelled
          if (toolPart.status === 'pending' || toolPart.status === 'running') {
            return { ...toolPart, status: 'cancelled' };
          }
        }
        if (part.type === 'operation') {
          const opPart = part;
          // Mark running operations as cancelled
          if (opPart.status === 'running') {
            return { ...opPart, status: 'cancelled' };
          }
        }
        if (part.type === 'text' || part.type === 'reasoning') {
          const textPart = part;
          // Mark streaming text/reasoning as done (it's not an error)
          if (textPart.status === 'streaming') {
            return { ...textPart, status: 'done' };
          }
        }
        if (part.type === 'object') {
          const objPart = part;
          // Mark streaming objects as done
          if (objPart.status === 'streaming') {
            return { ...objPart, status: 'done' };
          }
        }
        return part;
      });

      const finalMessage: UIMessage = {
        id: state.messageId,
        role: 'assistant',
        parts: finalParts,
        status: 'done',
        createdAt: new Date(),
      };

      const messages = [...this._messages];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.id === state.messageId) {
        messages[messages.length - 1] = finalMessage;
      } else {
        messages.push(finalMessage);
      }
      this.setMessages(messages);
    }

    this.streamingState = null;
    this.setStatus('idle');
    this.options.onStop?.();
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private handleStreamEvent(event: StreamEvent, state: StreamingState): void {
    switch (event.type) {
      case 'start':
        // Call onStart callback with execution/session ID
        if (event.executionId) {
          this.options.onStart?.(event.executionId);
        }
        break;

      case 'block-start': {
        const block: BlockState = {
          blockId: event.blockId,
          blockName: event.blockName,
          blockType: event.blockType,
          display: event.display,
          description: event.description,
          outputToChat: event.outputToChat ?? true,
          thread: event.thread,
          reasoning: '',
          text: '',
          toolCalls: new Map(),
        };
        state.blocks.set(event.blockId, block);
        state.activeBlock = block;

        const isOperation = OPERATION_BLOCK_TYPES.has(event.blockType);
        const isHidden = event.display === 'hidden';
        if (isOperation && !isHidden) {
          const thread = event.thread;
          const operationPart: UIOperationPart = {
            type: 'operation',
            operationId: event.blockId,
            name: event.description ?? event.blockName,
            operationType: event.blockType,
            status: 'running',
            thread: threadForPart(thread),
          };
          state.parts.push(operationPart);
        }

        state.currentTextPartIndex = null;
        state.currentReasoningPartIndex = null;

        this.updateStreamingMessage();
        break;
      }

      case 'block-end': {
        const operationPartIndex = state.parts.findIndex(
          (p: UIMessagePart) => p.type === 'operation' && p.operationId === event.blockId,
        );
        if (operationPartIndex >= 0) {
          const part = state.parts[operationPartIndex] as UIOperationPart;
          state.parts[operationPartIndex] = { ...part, status: 'done' };
        }

        if (state.activeBlock?.blockId === event.blockId) {
          state.activeBlock = null;
        }
        this.updateStreamingMessage();
        break;
      }

      case 'reasoning-start': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        const reasoningPart: UIReasoningPart = {
          type: 'reasoning',
          text: '',
          status: 'streaming',
          thread: threadForPart(state.activeBlock?.thread),
        };

        if (workerState) {
          // Add to worker's nested parts
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          workerPart.parts.push(reasoningPart);
          workerState.currentReasoningPartIndex = workerPart.parts.length - 1;
          state.parts[workerState.partIndex] = { ...workerPart };
        } else {
          state.parts.push(reasoningPart);
          state.currentReasoningPartIndex = state.parts.length - 1;
        }
        this.updateStreamingMessage();
        break;
      }

      case 'reasoning-delta': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          // Update worker's reasoning part
          if (workerState.currentReasoningPartIndex !== null) {
            const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
            const part = workerPart.parts[workerState.currentReasoningPartIndex] as UIReasoningPart;
            part.text += event.delta;
            workerPart.parts[workerState.currentReasoningPartIndex] = { ...part };
            state.parts[workerState.partIndex] = { ...workerPart };
          }
        } else {
          if (state.currentReasoningPartIndex !== null) {
            const part = state.parts[state.currentReasoningPartIndex] as UIReasoningPart;
            part.text += event.delta;
            state.parts[state.currentReasoningPartIndex] = { ...part };
          }

          if (state.activeBlock) {
            state.activeBlock.reasoning += event.delta;
          }
        }

        this.updateStreamingMessage();
        break;
      }

      case 'reasoning-end': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          // Finalize worker's reasoning part
          if (workerState.currentReasoningPartIndex !== null) {
            const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
            const part = workerPart.parts[workerState.currentReasoningPartIndex] as UIReasoningPart;
            part.status = 'done';
            workerPart.parts[workerState.currentReasoningPartIndex] = { ...part };
            state.parts[workerState.partIndex] = { ...workerPart };
            workerState.currentReasoningPartIndex = null;
          }
        } else if (state.currentReasoningPartIndex !== null) {
          const part = state.parts[state.currentReasoningPartIndex] as UIReasoningPart;
          part.status = 'done';
          state.parts[state.currentReasoningPartIndex] = { ...part };
          state.currentReasoningPartIndex = null;
        }
        this.updateStreamingMessage();
        break;
      }

      case 'text-start': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;
        const thread = threadForPart(state.activeBlock?.thread);
        const shouldAddPart = state.activeBlock?.outputToChat !== false || thread !== undefined;

        // For worker events, always add parts
        if (workerState || shouldAddPart) {
          // Structured output mode: accumulate JSON and parse progressively
          if (event.responseType) {
            const objectPart: UIObjectPart = {
              type: 'object',
              id: event.id,
              typeName: event.responseType,
              partial: undefined,
              object: undefined,
              status: 'streaming',
              thread,
            };
            if (workerState) {
              const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
              workerPart.parts.push(objectPart);
              workerState.currentObjectPartIndex = workerPart.parts.length - 1;
              workerState.accumulatedJson = '';
              workerState.currentTextPartIndex = null;
              state.parts[workerState.partIndex] = { ...workerPart };
            } else {
              state.parts.push(objectPart);
              state.currentObjectPartIndex = state.parts.length - 1;
              state.accumulatedJson = '';
              state.currentTextPartIndex = null;
            }
          } else {
            const textPart: UITextPart = {
              type: 'text',
              text: '',
              status: 'streaming',
              thread,
            };
            if (workerState) {
              const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
              workerPart.parts.push(textPart);
              workerState.currentTextPartIndex = workerPart.parts.length - 1;
              workerState.currentObjectPartIndex = null;
              state.parts[workerState.partIndex] = { ...workerPart };
            } else {
              state.parts.push(textPart);
              state.currentTextPartIndex = state.parts.length - 1;
              state.currentObjectPartIndex = null;
            }
          }
        }
        this.updateStreamingMessage();
        break;
      }

      case 'text-delta': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          // Update worker's text or object part
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          if (workerState.currentObjectPartIndex !== null) {
            workerState.accumulatedJson += event.delta;
            const part = workerPart.parts[workerState.currentObjectPartIndex] as UIObjectPart;
            const parsed = parsePartialJson(workerState.accumulatedJson);
            if (parsed !== undefined) {
              part.partial = parsed;
              workerPart.parts[workerState.currentObjectPartIndex] = { ...part };
            }
          } else if (workerState.currentTextPartIndex !== null) {
            const part = workerPart.parts[workerState.currentTextPartIndex] as UITextPart;
            part.text += event.delta;
            workerPart.parts[workerState.currentTextPartIndex] = { ...part };
          }
          state.parts[workerState.partIndex] = { ...workerPart };
        } else {
          if (state.currentObjectPartIndex !== null) {
            state.accumulatedJson += event.delta;
            const part = state.parts[state.currentObjectPartIndex] as UIObjectPart;
            const parsed = parsePartialJson(state.accumulatedJson);
            if (parsed !== undefined) {
              part.partial = parsed;
              state.parts[state.currentObjectPartIndex] = { ...part };
            }
          } else if (state.currentTextPartIndex !== null) {
            const part = state.parts[state.currentTextPartIndex] as UITextPart;
            part.text += event.delta;
            state.parts[state.currentTextPartIndex] = { ...part };
          }

          if (state.activeBlock) {
            state.activeBlock.text += event.delta;
          }
        }

        this.updateStreamingMessage();
        break;
      }

      case 'text-end': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          // Finalize worker's text or object part
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          if (workerState.currentObjectPartIndex !== null) {
            const part = workerPart.parts[workerState.currentObjectPartIndex] as UIObjectPart;
            try {
              const finalObject = JSON.parse(workerState.accumulatedJson) as unknown;
              part.object = finalObject;
              part.partial = finalObject;
              part.status = 'done';
            } catch {
              part.status = 'error';
              part.error = 'Failed to parse response as JSON';
            }
            workerPart.parts[workerState.currentObjectPartIndex] = { ...part };
            workerState.currentObjectPartIndex = null;
            workerState.accumulatedJson = '';
          } else if (workerState.currentTextPartIndex !== null) {
            const part = workerPart.parts[workerState.currentTextPartIndex] as UITextPart;
            part.status = 'done';
            workerPart.parts[workerState.currentTextPartIndex] = { ...part };
            workerState.currentTextPartIndex = null;
          }
          state.parts[workerState.partIndex] = { ...workerPart };
        } else if (state.currentObjectPartIndex !== null) {
          const part = state.parts[state.currentObjectPartIndex] as UIObjectPart;
          try {
            const finalObject = JSON.parse(state.accumulatedJson) as unknown;
            part.object = finalObject;
            part.partial = finalObject;
            part.status = 'done';
          } catch {
            part.status = 'error';
            part.error = 'Failed to parse response as JSON';
          }
          state.parts[state.currentObjectPartIndex] = { ...part };
          state.currentObjectPartIndex = null;
          state.accumulatedJson = '';
        } else if (state.currentTextPartIndex !== null) {
          const part = state.parts[state.currentTextPartIndex] as UITextPart;
          part.status = 'done';
          state.parts[state.currentTextPartIndex] = { ...part };
          state.currentTextPartIndex = null;
        }
        this.updateStreamingMessage();
        break;
      }

      case 'tool-input-start': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        const toolPart: UIToolCallPart = {
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          displayName: event.title,
          args: {},
          status: 'pending',
          thread: threadForPart(state.activeBlock?.thread),
        };

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          workerPart.parts.push(toolPart);
          state.parts[workerState.partIndex] = { ...workerPart };
        } else {
          state.parts.push(toolPart);

          if (state.activeBlock) {
            state.activeBlock.toolCalls.set(event.toolCallId, toolPart);
          }
        }

        this.updateStreamingMessage();
        break;
      }

      case 'tool-input-delta': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          const toolPartIndex = workerPart.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            try {
              const part = workerPart.parts[toolPartIndex] as UIToolCallPart;
              part.args = JSON.parse(event.inputTextDelta) as Record<string, unknown>;
              workerPart.parts[toolPartIndex] = { ...part };
              state.parts[workerState.partIndex] = { ...workerPart };
              this.updateStreamingMessage();
            } catch {
              // Partial JSON, ignore
            }
          }
        } else {
          const toolPartIndex = state.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            try {
              const part = state.parts[toolPartIndex] as UIToolCallPart;
              part.args = JSON.parse(event.inputTextDelta) as Record<string, unknown>;
              state.parts[toolPartIndex] = { ...part };
              this.updateStreamingMessage();
            } catch {
              // Partial JSON, ignore
            }
          }
        }
        break;
      }

      case 'tool-input-end':
        // Input streaming ended, wait for tool-input-available
        break;

      case 'tool-input-available': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          const toolPartIndex = workerPart.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = workerPart.parts[toolPartIndex] as UIToolCallPart;
            part.args = event.input as Record<string, unknown>;
            part.status = 'running';
            workerPart.parts[toolPartIndex] = { ...part };
            state.parts[workerState.partIndex] = { ...workerPart };
            this.updateStreamingMessage();
          }
        } else {
          const toolPartIndex = state.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = state.parts[toolPartIndex] as UIToolCallPart;
            part.args = event.input as Record<string, unknown>;
            part.status = 'running';
            state.parts[toolPartIndex] = { ...part };
            this.updateStreamingMessage();
          }
        }
        break;
      }

      case 'tool-output-available': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          const toolPartIndex = workerPart.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = workerPart.parts[toolPartIndex] as UIToolCallPart;
            part.result = event.output;
            part.status = 'done';
            workerPart.parts[toolPartIndex] = { ...part };
            state.parts[workerState.partIndex] = { ...workerPart };
            this.updateStreamingMessage();
          }
        } else {
          const toolPartIndex = state.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = state.parts[toolPartIndex] as UIToolCallPart;
            part.result = event.output;
            part.status = 'done';
            state.parts[toolPartIndex] = { ...part };
            this.updateStreamingMessage();
          }
        }
        break;
      }

      case 'tool-output-error': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          const toolPartIndex = workerPart.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = workerPart.parts[toolPartIndex] as UIToolCallPart;
            part.error = event.error;
            part.status = 'error';
            workerPart.parts[toolPartIndex] = { ...part };
            state.parts[workerState.partIndex] = { ...workerPart };
            this.updateStreamingMessage();
          }
        } else {
          const toolPartIndex = state.parts.findIndex(
            (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
          );
          if (toolPartIndex >= 0) {
            const part = state.parts[toolPartIndex] as UIToolCallPart;
            part.error = event.error;
            part.status = 'error';
            state.parts[toolPartIndex] = { ...part };
            this.updateStreamingMessage();
          }
        }
        break;
      }

      case 'source': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;
        const thread = threadForPart(state.activeBlock?.thread);

        let sourcePart: UISourcePart;
        if (event.sourceType === 'url') {
          sourcePart = {
            type: 'source',
            sourceType: 'url',
            id: event.id,
            url: event.url,
            title: event.title,
            thread,
          };
        } else {
          sourcePart = {
            type: 'source',
            sourceType: 'document',
            id: event.id,
            mediaType: event.mediaType,
            title: event.title,
            filename: event.filename,
            thread,
          };
        }

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          workerPart.parts.push(sourcePart);
          state.parts[workerState.partIndex] = { ...workerPart };
        } else {
          state.parts.push(sourcePart);
        }
        this.updateStreamingMessage();
        break;
      }

      case 'file-available': {
        const workerId = event.workerId;
        const workerState = workerId ? state.activeWorkers.get(workerId) : undefined;

        // Add generated file as a part
        const filePart: UIFilePart = {
          type: 'file',
          id: event.id,
          mediaType: event.mediaType,
          url: event.url,
          filename: event.filename,
          size: event.size,
          toolCallId: event.toolCallId,
          thread: threadForPart(state.activeBlock?.thread),
        };

        if (workerState) {
          const workerPart = state.parts[workerState.partIndex] as UIWorkerPart;
          workerPart.parts.push(filePart);
          state.parts[workerState.partIndex] = { ...workerPart };
        } else {
          state.parts.push(filePart);
        }
        this.updateStreamingMessage();
        break;
      }

      case 'resource-update':
        this.options.onResourceUpdate?.(event.name, event.value);
        break;

      case 'worker-start': {
        // Check if worker with same workerId already exists (for continuations)
        const existingIndex = state.parts.findIndex(
          (p) => p.type === 'worker' && p.workerId === event.workerId,
        );

        let partIndex: number;
        if (existingIndex !== -1) {
          // Re-use existing worker part (continuation)
          const existingPart = state.parts[existingIndex] as UIWorkerPart;
          existingPart.status = 'running';
          partIndex = existingIndex;
        } else {
          // Create a new worker part
          const workerPart: UIWorkerPart = {
            type: 'worker',
            workerId: event.workerId,
            workerSlug: event.workerSlug,
            workerSessionId: event.workerSessionId,
            parts: [],
            status: 'running',
          };
          state.parts.push(workerPart);
          partIndex = state.parts.length - 1;
        }

        // Track the worker for event routing
        const workerState: WorkerPartState = {
          partIndex,
          currentTextPartIndex: null,
          currentReasoningPartIndex: null,
          currentObjectPartIndex: null,
          accumulatedJson: '',
        };
        state.activeWorkers.set(event.workerId, workerState);
        this.updateStreamingMessage();
        break;
      }

      case 'worker-result': {
        const workerState = state.activeWorkers.get(event.workerId);
        if (workerState !== undefined) {
          const part = state.parts[workerState.partIndex] as UIWorkerPart;
          part.output = event.output;
          part.error = event.error;
          part.status = event.error ? 'error' : 'done';

          // Finalize any streaming parts in the worker
          part.parts = part.parts.map((p): UIMessagePart => {
            if (p.type === 'text' || p.type === 'reasoning') {
              if (p.status === 'streaming') {
                return { ...p, status: 'done' };
              }
            }
            if (p.type === 'object' && p.status === 'streaming') {
              return { ...p, status: 'done' };
            }
            return p;
          });

          state.parts[workerState.partIndex] = { ...part };
          state.activeWorkers.delete(event.workerId);
        }
        this.updateStreamingMessage();
        break;
      }

      case 'finish': {
        // Handle client-tool-calls finish reason
        if (event.finishReason === 'client-tool-calls') {
          // Mark that finish event has been received (for async tools that complete later)
          this._finishEventReceived = true;
          // Don't finalize message - we're waiting for client tools
          if (this._pendingToolsByCallId.size > 0) {
            this.setStatus('awaiting-input');
          } else if (this._readyToContinue) {
            // Automatic tools completed before finish event arrived - continue now
            this._readyToContinue = false;
            this._finishEventReceived = false;
            void this.continueWithClientToolResults();
          }
          return;
        }

        const finalMessage = buildMessageFromState(state, 'done');

        finalMessage.parts = finalMessage.parts.map((part) => {
          if (part.type === 'text' || part.type === 'reasoning') {
            return { ...part, status: 'done' as const };
          }
          if (part.type === 'object' && part.status === 'streaming') {
            return { ...part, status: 'done' as const };
          }
          return part;
        });

        if (finalMessage.parts.length > 0) {
          const messages = [...this._messages];
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.id === state.messageId) {
            messages[messages.length - 1] = finalMessage;
          } else {
            messages.push(finalMessage);
          }
          this.setMessages(messages);
        }

        this.setStatus('idle');
        this.streamingState = null;
        this.options.onFinish?.();
        break;
      }

      case 'error': {
        // Create structured error from the error event
        throw new OctavusError({
          errorType: event.errorType,
          message: event.message,
          source: event.source,
          retryable: event.retryable,
          retryAfter: event.retryAfter,
          code: event.code,
          provider: event.provider,
          tool: event.tool,
        });
      }

      case 'tool-request':
        // Handled by server-sdk, not relevant for UI
        break;

      case 'client-tool-request':
        // Store execution ID and server tool results for continuation
        this._pendingExecutionId = event.executionId;
        this._serverToolResults = event.serverToolResults ?? [];
        // Handle client-side tool execution
        void this.handleClientToolRequest(event.toolCalls, state);
        break;
    }
  }

  private updateStreamingMessage(): void {
    const state = this.streamingState;
    if (!state) return;

    const msg = buildMessageFromState(state, 'streaming');
    const messages = [...this._messages];

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.id === state.messageId) {
      messages[messages.length - 1] = msg;
    } else {
      messages.push(msg);
    }

    this.setMessages(messages);
  }

  /**
   * Emit a tool-output-available event for a client tool result.
   */
  private emitToolOutputAvailable(toolCallId: string, output: unknown): void {
    const state = this.streamingState;
    if (!state) return;

    const toolPartIndex = state.parts.findIndex(
      (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === toolCallId,
    );
    if (toolPartIndex >= 0) {
      const part = state.parts[toolPartIndex] as UIToolCallPart;
      part.result = output;
      part.status = 'done';
      state.parts[toolPartIndex] = { ...part };
      this.updateStreamingMessage();
    }
  }

  /**
   * Emit a tool-output-error event for a client tool result.
   */
  private emitToolOutputError(toolCallId: string, error: string): void {
    const state = this.streamingState;
    if (!state) return;

    const toolPartIndex = state.parts.findIndex(
      (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === toolCallId,
    );
    if (toolPartIndex >= 0) {
      const part = state.parts[toolPartIndex] as UIToolCallPart;
      part.error = error;
      part.status = 'error';
      state.parts[toolPartIndex] = { ...part };
      this.updateStreamingMessage();
    }
  }

  /**
   * Continue execution with collected client tool results.
   */
  private async continueWithClientToolResults(): Promise<void> {
    if (this._completedToolResults.length === 0) return;

    if (this._pendingExecutionId === null) {
      // Context lost - this shouldn't happen, but handle gracefully
      const errorObj = new OctavusError({
        errorType: 'internal_error',
        message: 'Cannot continue execution: execution ID was lost.',
        source: 'client',
        retryable: false,
      });
      this.setError(errorObj);
      this.setStatus('error');
      this.options.onError?.(errorObj);
      return;
    }

    // Combine server results (from mixed tools scenario) with client results
    const allResults = [...this._serverToolResults, ...this._completedToolResults];
    const executionId = this._pendingExecutionId;
    this._serverToolResults = [];
    this._completedToolResults = [];
    this._pendingExecutionId = null;

    this.setStatus('streaming');

    try {
      // Use the transport's continuation method (works for both HTTP and Socket)
      for await (const event of this.transport.continueWithToolResults(executionId, allResults)) {
        if (this.streamingState === null) break;
        this.handleStreamEvent(event, this.streamingState);
      }
    } catch (err) {
      const errorObj = OctavusError.isInstance(err)
        ? err
        : new OctavusError({
            errorType: 'internal_error',
            message: err instanceof Error ? err.message : 'Unknown error',
            source: 'client',
            retryable: false,
            cause: err,
          });

      this.setError(errorObj);
      this.setStatus('error');
      this.streamingState = null;
      this.options.onError?.(errorObj);
    }
  }

  /**
   * Handle client tool request event.
   *
   * IMPORTANT: Interactive tools must be registered synchronously (before any await)
   * to avoid a race condition where the finish event is processed before tools are added.
   */
  private async handleClientToolRequest(
    toolCalls: PendingToolCall[],
    state: StreamingState,
  ): Promise<void> {
    this._clientToolAbortController = new AbortController();

    // FIRST PASS: Register all interactive tools synchronously (no await)
    // This ensures pending tools are populated before finish event is processed
    for (const tc of toolCalls) {
      const handler = this.options.clientTools?.[tc.toolName];
      if (handler === 'interactive') {
        const toolState: PendingToolState = {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
          source: tc.source,
          outputVariable: tc.outputVariable,
          blockIndex: tc.blockIndex,
          thread: tc.thread,
        };
        // Add to both maps
        this._pendingToolsByCallId.set(tc.toolCallId, toolState);
        const existing = this._pendingToolsByName.get(tc.toolName) ?? [];
        this._pendingToolsByName.set(tc.toolName, [...existing, toolState]);
      }
    }
    if (this._pendingToolsByCallId.size > 0) {
      this.updatePendingClientToolsCache();
    }

    // SECOND PASS: Execute automatic handlers and handle missing handlers
    for (const tc of toolCalls) {
      const handler = this.options.clientTools?.[tc.toolName];

      if (handler === 'interactive') {
        // Already registered above, just update UI state
        const toolPartIndex = state.parts.findIndex(
          (p: UIMessagePart) => p.type === 'tool-call' && p.toolCallId === tc.toolCallId,
        );
        if (toolPartIndex >= 0) {
          const part = state.parts[toolPartIndex] as UIToolCallPart;
          // Keep running status - user will see the tool is "executing" while modal is open
          state.parts[toolPartIndex] = { ...part };
        }
      } else if (handler) {
        try {
          const result = await handler(tc.args, {
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            signal: this._clientToolAbortController.signal,
          });

          this._completedToolResults.push({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            result,
            outputVariable: tc.outputVariable,
            blockIndex: tc.blockIndex,
            thread: tc.thread,
          });

          this.emitToolOutputAvailable(tc.toolCallId, result);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Tool execution failed';
          this._completedToolResults.push({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            error: errorMessage,
            outputVariable: tc.outputVariable,
            blockIndex: tc.blockIndex,
            thread: tc.thread,
          });

          this.emitToolOutputError(tc.toolCallId, errorMessage);
        }
      } else {
        // No handler registered - treat as error
        const errorMessage = `No client handler for tool: ${tc.toolName}`;
        this._completedToolResults.push({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          error: errorMessage,
          outputVariable: tc.outputVariable,
          blockIndex: tc.blockIndex,
          thread: tc.thread,
        });

        this.emitToolOutputError(tc.toolCallId, errorMessage);
      }
    }

    // If no interactive tools, mark as ready to continue.
    // We wait for the finish event to arrive first to avoid a race condition where
    // the finish event gets delivered to the continuation's event resolver.
    if (this._pendingToolsByCallId.size === 0 && this._completedToolResults.length > 0) {
      this._readyToContinue = true;

      // If finish event already arrived while we were executing async tools,
      // trigger continuation now instead of waiting forever
      if (this._finishEventReceived) {
        this._readyToContinue = false;
        this._finishEventReceived = false;
        void this.continueWithClientToolResults();
      }
    }
  }
}
