import { safeParseStreamEvent, type StreamEvent, type ToolResult } from '@octavus/core';
import type { SocketTransport, ConnectionState, ConnectionStateListener } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Socket interface compatible with both WebSocket and SockJS.
 *
 * Uses MessageEvent for the message handler, which both WebSocket and SockJS support.
 * The `| undefined` union accommodates SockJS's optional property typing.
 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onmessage: ((event: MessageEvent) => void) | null | undefined;
  onclose: ((event: CloseEvent) => void) | null | undefined;
}

/** WebSocket readyState constants */
const SOCKET_OPEN = 1;

// =============================================================================
// Transport Options
// =============================================================================

/**
 * Options for creating a socket transport.
 */
export interface SocketTransportOptions {
  /**
   * Function to create and connect the socket.
   * Works directly with WebSocket and SockJS - no wrappers needed.
   *
   * @example Native WebSocket
   * ```typescript
   * connect: () => new Promise((resolve, reject) => {
   *   const ws = new WebSocket('wss://api.example.com/stream?sessionId=xxx');
   *   ws.onopen = () => resolve(ws);
   *   ws.onerror = () => reject(new Error('Connection failed'));
   * })
   * ```
   *
   * @example SockJS
   * ```typescript
   * connect: () => new Promise((resolve, reject) => {
   *   const sock = new SockJS('/chat-service');
   *   sock.onopen = () => resolve(sock);
   *   sock.onerror = () => reject(new Error('Connection failed'));
   * })
   * ```
   */
  connect: () => Promise<SocketLike>;

  /**
   * Called for every message received (parsed as JSON).
   * Use this to handle custom (non-Octavus) events.
   * Octavus StreamEvents are handled automatically by the transport.
   *
   * @example
   * ```typescript
   * onMessage: (data) => {
   *   const msg = data as { type: string };
   *   if (msg.type === 'typing-indicator') {
   *     setIsTyping(true);
   *   }
   *   if (msg.type === 'presence-update') {
   *     updatePresence(msg.users);
   *   }
   * }
   * ```
   */
  onMessage?: (data: unknown) => void;

  /**
   * Called when the socket connection closes.
   * Use this for cleanup or reconnection logic.
   */
  onClose?: () => void;
}

/**
 * Create a socket transport that works with any WebSocket-like connection.
 * Supports native WebSocket, SockJS, or any compatible socket implementation.
 *
 * The server should send StreamEvent format (same as SSE) over the socket.
 * Unknown events are safely ignored using Zod validation.
 *
 * ## Connection Lifecycle
 *
 * By default, the socket connects **lazily** on the first `send()` call.
 * Use `connect()` to establish the connection eagerly (e.g., on component mount):
 *
 * ```typescript
 * // Eager connection for UI status indicators
 * useEffect(() => {
 *   transport.connect()
 *     .then(() => console.log('Connected'))
 *     .catch((err) => console.error('Failed:', err));
 *
 *   return () => transport.disconnect();
 * }, [transport]);
 * ```
 *
 * @example Basic usage with WebSocket
 * ```typescript
 * const transport = createSocketTransport({
 *   connect: () => new Promise((resolve, reject) => {
 *     const ws = new WebSocket(`wss://api.octavus.ai/stream?sessionId=${sessionId}`);
 *     ws.onopen = () => resolve(ws);
 *     ws.onerror = () => reject(new Error('Connection failed'));
 *   }),
 * });
 * ```
 *
 * @example With SockJS and connection state
 * ```typescript
 * const transport = createSocketTransport({
 *   connect: () => new Promise((resolve, reject) => {
 *     const sock = new SockJS('/octavus-stream');
 *     sock.onopen = () => resolve(sock);
 *     sock.onerror = () => reject(new Error('Connection failed'));
 *   }),
 * });
 *
 * // Subscribe to connection state changes
 * transport.onConnectionStateChange((state, error) => {
 *   setConnectionState(state);
 *   if (error) setConnectionError(error);
 * });
 * ```
 */
export function createSocketTransport(options: SocketTransportOptions): SocketTransport {
  let socket: SocketLike | null = null;
  let eventQueue: StreamEvent[] = [];
  let eventResolver: ((event: StreamEvent | null) => void) | null = null;
  let isStreaming = false;

  let connectionState: ConnectionState = 'disconnected';
  let connectionError: Error | undefined;
  let connectionPromise: Promise<void> | null = null;
  const connectionListeners = new Set<ConnectionStateListener>();

  function setConnectionState(state: ConnectionState, error?: Error) {
    connectionState = state;
    connectionError = error;
    connectionListeners.forEach((listener) => listener(state, error));
  }

  function enqueueEvent(event: StreamEvent) {
    if (eventResolver) {
      eventResolver(event);
      eventResolver = null;
    } else {
      eventQueue.push(event);
    }
  }

  function nextEvent(): Promise<StreamEvent | null> {
    if (eventQueue.length > 0) {
      return Promise.resolve(eventQueue.shift()!);
    }
    if (!isStreaming) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      eventResolver = resolve;
    });
  }

  function setupSocketHandlers(sock: SocketLike): void {
    sock.onmessage = (e: MessageEvent) => {
      try {
        const data: unknown = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;

        options.onMessage?.(data);

        const result = safeParseStreamEvent(data);
        if (result.success) {
          const event = result.data;
          enqueueEvent(event);

          if (event.type === 'finish' || event.type === 'error') {
            isStreaming = false;
          }
        }
      } catch {
        // Malformed JSON, skip
      }
    };

    sock.onclose = () => {
      socket = null;
      connectionPromise = null;
      setConnectionState('disconnected');
      options.onClose?.();

      isStreaming = false;
      if (eventResolver) {
        eventResolver(null);
        eventResolver = null;
      }
    };
  }

  async function ensureConnected(): Promise<void> {
    // Already connected
    if (socket?.readyState === SOCKET_OPEN) {
      return;
    }

    // Connection in progress - wait for it
    if (connectionPromise) {
      await connectionPromise;
      return;
    }

    // Start new connection
    setConnectionState('connecting');

    connectionPromise = (async () => {
      try {
        const sock = await options.connect();
        socket = sock;
        setupSocketHandlers(sock);
        setConnectionState('connected');
      } catch (err) {
        socket = null;
        connectionPromise = null;
        const error = err instanceof Error ? err : new Error('Connection failed');
        setConnectionState('error', error);
        throw error;
      }
    })();

    await connectionPromise;
  }

  return {
    // =========================================================================
    // Connection Management
    // =========================================================================

    get connectionState(): ConnectionState {
      return connectionState;
    },

    onConnectionStateChange(listener: ConnectionStateListener): () => void {
      connectionListeners.add(listener);
      // Immediately notify with current state
      listener(connectionState, connectionError);
      return () => connectionListeners.delete(listener);
    },

    async connect(): Promise<void> {
      await ensureConnected();
    },

    disconnect(): void {
      if (socket) {
        socket.close();
        socket = null;
      }
      connectionPromise = null;
      isStreaming = false;
      if (eventResolver) {
        eventResolver(null);
        eventResolver = null;
      }
      setConnectionState('disconnected');
    },

    // =========================================================================
    // Streaming
    // =========================================================================

    async *trigger(triggerName, input) {
      await ensureConnected();

      eventQueue = [];
      eventResolver = null; // Clear any pending resolver
      isStreaming = true;

      // Note: clientToolResults not sent here - socket uses sendClientToolResults() for continuation
      socket!.send(
        JSON.stringify({
          type: 'trigger',
          triggerName,
          input,
        }),
      );

      while (true) {
        const event = await nextEvent();
        if (event === null) break;
        yield event;
        if (event.type === 'finish' || event.type === 'error') break;
      }
    },

    stop() {
      if (socket?.readyState === SOCKET_OPEN) {
        socket.send(JSON.stringify({ type: 'stop' }));
      }
      isStreaming = false;
      if (eventResolver) {
        eventResolver(null);
        eventResolver = null;
      }
    },

    /**
     * Continue execution with tool results after client-side tool handling.
     * @param executionId - The execution ID from the client-tool-request event
     * @param toolResults - All tool results (server + client) to send
     */
    async *continueWithToolResults(executionId: string, toolResults: ToolResult[]) {
      await ensureConnected();

      eventQueue = [];
      eventResolver = null; // Clear any pending resolver from previous operation
      isStreaming = true;

      socket!.send(
        JSON.stringify({
          type: 'continue',
          executionId,
          toolResults,
        }),
      );

      while (true) {
        const event = await nextEvent();
        if (event === null) break;
        yield event;
        if (event.type === 'finish' || event.type === 'error') break;
      }
    },
  };
}
