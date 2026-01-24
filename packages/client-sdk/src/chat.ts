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
  type DisplayMode,
  type StreamEvent,
  type FileReference,
} from '@octavus/core';
import type { Transport } from './transports/types';
import { uploadFiles, type UploadFilesOptions } from './files';

/** Block types that are internal operations (not LLM-driven) */
const OPERATION_BLOCK_TYPES = new Set(['set-resource', 'serialize-thread', 'generate-image']);

// =============================================================================
// Types
// =============================================================================

export type ChatStatus = 'idle' | 'streaming' | 'error';

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

interface StreamingState {
  messageId: string;
  parts: UIMessagePart[];
  activeBlock: BlockState | null;
  blocks: Map<string, BlockState>;
  currentTextPartIndex: number | null;
  currentReasoningPartIndex: number | null;
  currentObjectPartIndex: number | null;
  accumulatedJson: string;
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
 *     triggerRequest: (triggerName, input) =>
 *       fetch('/api/trigger', {
 *         method: 'POST',
 *         body: JSON.stringify({ sessionId, triggerName, input }),
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

  /** Stop the current streaming and finalize any partial message */
  stop(): void {
    if (this._status !== 'streaming') {
      return;
    }

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
        const reasoningPart: UIReasoningPart = {
          type: 'reasoning',
          text: '',
          status: 'streaming',
          thread: threadForPart(state.activeBlock?.thread),
        };
        state.parts.push(reasoningPart);
        state.currentReasoningPartIndex = state.parts.length - 1;
        this.updateStreamingMessage();
        break;
      }

      case 'reasoning-delta': {
        if (state.currentReasoningPartIndex !== null) {
          const part = state.parts[state.currentReasoningPartIndex] as UIReasoningPart;
          part.text += event.delta;
          state.parts[state.currentReasoningPartIndex] = { ...part };
        }

        if (state.activeBlock) {
          state.activeBlock.reasoning += event.delta;
        }

        this.updateStreamingMessage();
        break;
      }

      case 'reasoning-end': {
        if (state.currentReasoningPartIndex !== null) {
          const part = state.parts[state.currentReasoningPartIndex] as UIReasoningPart;
          part.status = 'done';
          state.parts[state.currentReasoningPartIndex] = { ...part };
          state.currentReasoningPartIndex = null;
        }
        this.updateStreamingMessage();
        break;
      }

      case 'text-start': {
        const thread = threadForPart(state.activeBlock?.thread);
        const shouldAddPart = state.activeBlock?.outputToChat !== false || thread !== undefined;

        if (shouldAddPart) {
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
            state.parts.push(objectPart);
            state.currentObjectPartIndex = state.parts.length - 1;
            state.accumulatedJson = '';
            state.currentTextPartIndex = null;
          } else {
            const textPart: UITextPart = {
              type: 'text',
              text: '',
              status: 'streaming',
              thread,
            };
            state.parts.push(textPart);
            state.currentTextPartIndex = state.parts.length - 1;
            state.currentObjectPartIndex = null;
          }
        }
        this.updateStreamingMessage();
        break;
      }

      case 'text-delta': {
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

        this.updateStreamingMessage();
        break;
      }

      case 'text-end': {
        if (state.currentObjectPartIndex !== null) {
          const part = state.parts[state.currentObjectPartIndex] as UIObjectPart;
          try {
            const finalObject = JSON.parse(state.accumulatedJson) as unknown;
            part.object = finalObject;
            part.partial = finalObject;
            part.status = 'done';
          } catch {
            // Keep partial data but mark as error
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
        const toolPart: UIToolCallPart = {
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          displayName: event.title,
          args: {},
          status: 'pending',
          thread: threadForPart(state.activeBlock?.thread),
        };
        state.parts.push(toolPart);

        if (state.activeBlock) {
          state.activeBlock.toolCalls.set(event.toolCallId, toolPart);
        }

        this.updateStreamingMessage();
        break;
      }

      case 'tool-input-delta': {
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
        break;
      }

      case 'tool-input-end':
        // Input streaming ended, wait for tool-input-available
        break;

      case 'tool-input-available': {
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
        break;
      }

      case 'tool-output-available': {
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
        break;
      }

      case 'tool-output-error': {
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
        break;
      }

      case 'source': {
        // Add source (URL or document) as a part
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

        state.parts.push(sourcePart);
        this.updateStreamingMessage();
        break;
      }

      case 'file-available': {
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
        state.parts.push(filePart);
        this.updateStreamingMessage();
        break;
      }

      case 'resource-update':
        this.options.onResourceUpdate?.(event.name, event.value);
        break;

      case 'finish': {
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
}
