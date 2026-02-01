'use client';

import { useRef, useCallback, useSyncExternalStore, useState, useEffect } from 'react';
import {
  OctavusChat,
  type OctavusError,
  isSocketTransport,
  type OctavusChatOptions,
  type ChatStatus,
  type UserMessageInput,
  type UIMessage,
  type Transport,
  type ConnectionState,
  type FileReference,
  type UploadFilesOptions,
  type UploadUrlsResponse,
  type ClientToolContext,
  type ClientToolHandler,
  type InteractiveTool,
} from '@octavus/client-sdk';

export type {
  OctavusChatOptions,
  ChatStatus,
  UserMessageInput,
  FileReference,
  UploadFilesOptions,
  UploadUrlsResponse,
  ClientToolContext,
  ClientToolHandler,
  InteractiveTool,
};

export interface UseOctavusChatReturn {
  /** All messages including the currently streaming one */
  messages: UIMessage[];
  /** Current status of the chat */
  status: ChatStatus;
  /**
   * Error if status is 'error'.
   * Contains structured error information including type, source, and retryability.
   * Use type guards like `isRateLimitError()` or `isProviderError()` to check specific error types.
   */
  error: OctavusError | null;
  /**
   * The current session/execution ID from the most recent `send()` call.
   * Updated when the server responds with a `start` event containing an execution ID.
   * Useful for tracking activity logs or debugging.
   *
   * For workers, this is the execution ID. For interactive sessions, this is the session ID.
   */
  sessionId: string | null;
  /**
   * Socket connection state (socket transport only).
   * For HTTP transport, this is always `undefined`.
   *
   * - `disconnected`: Not connected (initial state before first send)
   * - `connecting`: Connection attempt in progress
   * - `connected`: Successfully connected
   * - `error`: Connection failed (check `connectionError`)
   */
  connectionState: ConnectionState | undefined;
  /**
   * Connection error if `connectionState` is 'error'.
   */
  connectionError: Error | undefined;
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
  pendingClientTools: Record<string, InteractiveTool[]>;
  /**
   * Trigger the agent and optionally add a user message to the chat.
   *
   * @param triggerName - The trigger name defined in the agent's protocol.yaml
   * @param input - Input parameters for the trigger (variable substitutions)
   * @param options.userMessage - If provided, adds a user message to the chat before triggering
   */
  send: (
    triggerName: string,
    input?: Record<string, unknown>,
    options?: { userMessage?: UserMessageInput },
  ) => Promise<void>;
  /** Stop the current streaming and finalize any partial message */
  stop: () => void;
  /**
   * Eagerly connect to the socket (socket transport only).
   * Returns a promise that resolves when connected or rejects on error.
   * Safe to call multiple times - subsequent calls resolve immediately if already connected.
   *
   * For HTTP transport, this is `undefined`.
   */
  connect: (() => Promise<void>) | undefined;
  /**
   * Disconnect the socket (socket transport only).
   * The transport will reconnect automatically on next send().
   *
   * For HTTP transport, this is `undefined`.
   */
  disconnect: (() => void) | undefined;
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
   * const fileRefs = await uploadFiles(fileInput.files, (i, progress) => {
   *   console.log(`File ${i}: ${progress}%`);
   * });
   * // Later...
   * await send('user-message', { FILES: fileRefs }, { userMessage: { files: fileRefs } });
   * ```
   */
  uploadFiles: (
    files: FileList | File[],
    onProgress?: (fileIndex: number, progress: number) => void,
  ) => Promise<FileReference[]>;
}

/**
 * React hook for interacting with Octavus agents.
 * Provides chat state management and streaming support.
 *
 * When the transport changes (e.g., sessionId changes), the hook automatically
 * reinitializes with a fresh chat instance. Use `initialMessages` if you need
 * to preserve messages across transport changes.
 *
 * @example Basic usage with HTTP transport
 * ```tsx
 * import { useOctavusChat, createHttpTransport } from '@octavus/react';
 *
 * function Chat({ sessionId }) {
 *   const transport = useMemo(
 *     () => createHttpTransport({
 *       request: (payload, options) =>
 *         fetch('/api/trigger', {
 *           method: 'POST',
 *           headers: { 'Content-Type': 'application/json' },
 *           body: JSON.stringify({ sessionId, ...payload }),
 *           signal: options?.signal,
 *         }),
 *     }),
 *     [sessionId],
 *   );
 *
 *   const { messages, status, send } = useOctavusChat({ transport });
 *
 *   return (
 *     <div>
 *       {messages.map((msg) => (
 *         <Message key={msg.id} message={msg} />
 *       ))}
 *       <button onClick={() => send('user-message', { USER_MESSAGE: 'Hello' })}>
 *         Send
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example Socket transport with eager connection
 * ```tsx
 * import { useOctavusChat, createSocketTransport } from '@octavus/react';
 *
 * function Chat() {
 *   const transport = useMemo(
 *     () => createSocketTransport({
 *       connect: () => new Promise((resolve, reject) => {
 *         const sock = new SockJS('/octavus');
 *         sock.onopen = () => resolve(sock);
 *         sock.onerror = () => reject(new Error('Connection failed'));
 *       }),
 *     }),
 *     [],
 *   );
 *
 *   const { messages, status, send, connectionState, connect, disconnect } =
 *     useOctavusChat({ transport });
 *
 *   // Eager connection on mount
 *   useEffect(() => {
 *     connect?.();
 *     return () => disconnect?.();
 *   }, [connect, disconnect]);
 *
 *   return (
 *     <div>
 *       <StatusIndicator state={connectionState} />
 *       {messages.map((msg) => <Message key={msg.id} message={msg} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useOctavusChat(options: OctavusChatOptions): UseOctavusChatReturn {
  const chatRef = useRef<OctavusChat | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Store the session ID setter in a ref so we can use it in a stable callback
  const sessionIdSetterRef = useRef(setSessionId);
  sessionIdSetterRef.current = setSessionId;

  // Store user's onStart callback in a ref
  const userOnStartRef = useRef(options.onStart);
  userOnStartRef.current = options.onStart;

  if (transportRef.current !== options.transport) {
    chatRef.current?.stop();
    // Reset session ID when transport changes
    setSessionId(null);
    // Create chat with wrapped onStart callback
    chatRef.current = new OctavusChat({
      ...options,
      onStart: (id) => {
        sessionIdSetterRef.current(id);
        userOnStartRef.current?.(id);
      },
    });
    transportRef.current = options.transport;
  }

  const chat = chatRef.current!;
  const transport = options.transport;

  const subscribe = useCallback((callback: () => void) => chat.subscribe(callback), [chat]);
  const getMessagesSnapshot = useCallback(() => chat.messages, [chat]);
  const getStatusSnapshot = useCallback(() => chat.status, [chat]);
  const getErrorSnapshot = useCallback(() => chat.error, [chat]);
  const getPendingClientToolsSnapshot = useCallback(() => chat.pendingClientTools, [chat]);

  const messages = useSyncExternalStore(subscribe, getMessagesSnapshot, getMessagesSnapshot);
  const status = useSyncExternalStore(subscribe, getStatusSnapshot, getStatusSnapshot);
  const error = useSyncExternalStore(subscribe, getErrorSnapshot, getErrorSnapshot);
  const pendingClientTools = useSyncExternalStore(
    subscribe,
    getPendingClientToolsSnapshot,
    getPendingClientToolsSnapshot,
  );

  const socketTransport = isSocketTransport(transport) ? transport : null;
  const [connectionState, setConnectionState] = useState<ConnectionState | undefined>(
    socketTransport?.connectionState,
  );
  const [connectionError, setConnectionError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    if (!socketTransport) {
      setConnectionState(undefined);
      setConnectionError(undefined);
      return;
    }

    const unsubscribe = socketTransport.onConnectionStateChange((state, err) => {
      setConnectionState(state);
      setConnectionError(err);
    });

    return unsubscribe;
  }, [socketTransport]);

  const send = useCallback(
    (
      triggerName: string,
      input?: Record<string, unknown>,
      sendOptions?: { userMessage?: UserMessageInput },
    ) => chat.send(triggerName, input, sendOptions),
    [chat],
  );

  const stop = useCallback(() => chat.stop(), [chat]);

  const uploadFiles = useCallback(
    (files: FileList | File[], onProgress?: (fileIndex: number, progress: number) => void) =>
      chat.uploadFiles(files, onProgress),
    [chat],
  );

  // Stable references for connect/disconnect (socket transport only)
  const connect = useCallback(
    () => socketTransport?.connect() ?? Promise.resolve(),
    [socketTransport],
  );
  const disconnect = useCallback(() => socketTransport?.disconnect(), [socketTransport]);

  return {
    messages,
    status,
    error,
    sessionId,
    connectionState,
    connectionError,
    pendingClientTools,
    send,
    stop,
    connect: socketTransport ? connect : undefined,
    disconnect: socketTransport ? disconnect : undefined,
    uploadFiles,
  };
}
