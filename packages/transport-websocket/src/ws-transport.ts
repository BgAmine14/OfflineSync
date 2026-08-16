/**
 * WebSocketSyncTransport — real-time bidirectional sync transport.
 *
 * Implements the SyncTransport interface over a persistent WebSocket
 * connection. In addition to request/response sync operations, this
 * transport supports:
 *
 * 1. **Server-push**: The server can proactively send changes to the
 *    client via `push:changes` messages, enabling real-time updates.
 * 2. **Heartbeat/keepalive**: Periodic PING/PONG messages detect stale
 *    connections and trigger reconnection before the TCP layer notices.
 * 3. **Automatic reconnection**: Exponential backoff reconnection with
 *    configurable base delay, multiplier, and max delay.
 * 4. **Connection lifecycle**: `connect()` / `disconnect()` / `dispose()`
 *    with proper cleanup of timers and listeners.
 *
 * The transport uses a message-framing protocol with a `type` discriminator
 * (see ws-types.ts) and a request/response correlation via `id` fields.
 *
 * WebSocket construction is abstracted behind a `WebSocketFactory` so
 * the transport can be used in Node.js (with the `ws` package), browsers,
 * or tests without being coupled to any specific WebSocket implementation.
 */

import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
  Change,
} from '@offlinesync/protocol';
import {
  isSyncResponse,
  isSnapshotResponse,
  isChange,
  SYNC_ERROR_CODE,
} from '@offlinesync/protocol';
import type { SyncTransport, VersionInfo } from '@offlinesync/transport-http';
import { SyncTransportError } from '@offlinesync/transport-http';
import {
  WS_MSG_TYPE,
  type WsClientMessage,
  type WsServerMessage,
  type WsPushChangesMsg,
  type WsErrorMsg,
  type WsPongMsg,
  isWsServerMessage,
} from './ws-types.js';

// -------------------------------------------------------------------
// WebSocket abstraction
// -------------------------------------------------------------------

/**
 * Minimal interface that any WebSocket implementation must satisfy.
 *
 * Both the browser `WebSocket` and Node.js `ws` package satisfy this
 * interface, making the transport portable across runtimes.
 */
export interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'message' | 'open' | 'close' | 'error',
    listener: EventListener,
  ): void;
  removeEventListener(
    type: 'message' | 'open' | 'close' | 'error',
    listener: EventListener,
  ): void;
}

/**
 * Factory function that creates a new WebSocket connection.
 * This abstraction allows injecting mock WebSockets in tests.
 */
export type WebSocketFactory = (url: string) => MinimalWebSocket;

// -------------------------------------------------------------------
// Connection state
// -------------------------------------------------------------------

/**
 * Publicly observable connection state of the WebSocket transport.
 */
export const WS_CONNECTION_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISPOSED: 'disposed',
} as const;

export type WsConnectionState =
  (typeof WS_CONNECTION_STATE)[keyof typeof WS_CONNECTION_STATE];

/**
 * Callback invoked when the connection state changes.
 */
export type OnConnectionStateChange = (state: WsConnectionState) => void;

/**
 * Callback invoked when the server pushes changes in real time.
 */
export type OnPushChanges = (changes: readonly Change[], cursor: string) => void;

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

/**
 * Configuration options for WebSocketSyncTransport.
 */
export interface WebSocketTransportOptions {
  /** URL of the WebSocket sync endpoint (e.g., 'wss://api.example.com/sync'). */
  readonly url: string;
  /**
   * Factory function for creating WebSocket connections.
   * Defaults to `() => new WebSocket(url)` in browsers.
   */
  readonly wsFactory?: WebSocketFactory;
  /**
   * Interval in milliseconds between heartbeat PINGs.
   * Set to 0 to disable heartbeat.
   * @default 30_000 (30 seconds)
   */
  readonly heartbeatIntervalMs?: number;
  /**
   * Maximum time in milliseconds to wait for a PONG before
   * considering the connection dead.
   * @default 10_000 (10 seconds)
   */
  readonly pongTimeoutMs?: number;
  /**
   * Reconnection backoff base delay in milliseconds.
   * @default 1_000 (1 second)
   */
  readonly reconnectBaseDelayMs?: number;
  /**
   * Multiplier applied to the delay after each failed reconnection.
   * @default 2
   */
  readonly reconnectMultiplier?: number;
  /**
   * Maximum reconnection delay in milliseconds.
   * @default 30_000 (30 seconds)
   */
  readonly reconnectMaxDelayMs?: number;
  /**
   * Maximum number of reconnection attempts before giving up.
   * Set to 0 for unlimited retries.
   * @default 0 (unlimited)
   */
  readonly maxReconnectAttempts?: number;
  /**
   * Optional headers/subprotocols for the WebSocket handshake.
   * Passed as the second argument to the WebSocket constructor in browsers.
   */
  readonly protocols?: string | string[];
}

// -------------------------------------------------------------------
// Internal request tracking
// -------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_PONG_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MULTIPLIER = 2;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 0;

// -------------------------------------------------------------------
// WebSocketSyncTransport
// -------------------------------------------------------------------

/**
 * WebSocket implementation of the sync transport.
 *
 * Maintains a persistent bidirectional connection to the sync server.
 * Request/response operations (version negotiation, sync, snapshot)
 * are correlated by a unique message ID. The server can also push
 * changes to the client at any time.
 *
 * @example
 * ```typescript
 * const transport = new WebSocketSyncTransport({
 *   url: 'wss://api.example.com/sync',
 *   heartbeatIntervalMs: 15_000,
 * });
 *
 * transport.onConnectionStateChange((state) => {
 *   console.log('Connection:', state);
 * });
 *
 * transport.onPush((changes, cursor) => {
 *   console.log(`Received ${changes.length} pushed changes, cursor=${cursor}`);
 * });
 *
 * await transport.connect();
 * ```
 */
export class WebSocketSyncTransport implements SyncTransport {
  private readonly url: string;
  private readonly wsFactory: WebSocketFactory;
  private readonly heartbeatIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMultiplier: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private ws: MinimalWebSocket | null = null;
  private connectionState: WsConnectionState = WS_CONNECTION_STATE.DISCONNECTED;
  private messageIdCounter = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private connectionStateListeners = new Set<OnConnectionStateChange>();
  private pushListeners = new Set<OnPushChanges>();

  // Heartbeat timers
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private disposed = false;

  // Bound event handlers (so we can remove them)
  private readonly handleMessage: EventListener;
  private readonly handleOpen: EventListener;
  private readonly handleClose: EventListener;
  private readonly handleError: EventListener;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.wsFactory = options.wsFactory ?? defaultWsFactory;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMultiplier = options.reconnectMultiplier ?? DEFAULT_RECONNECT_MULTIPLIER;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;

    // Bind handlers once so we can cleanly add/remove them
    this.handleMessage = this.onMessage.bind(this);
    this.handleOpen = this.onOpen.bind(this);
    this.handleClose = this.onClose.bind(this);
    this.handleError = this.onError.bind(this);
  }

  // ----------------------------------------------------------------
  // Connection lifecycle
  // ----------------------------------------------------------------

  /**
   * Open the WebSocket connection.
   *
   * If the transport is already connected or connecting, this is a no-op.
   * If the transport is reconnecting, this cancels the scheduled
   * reconnection and connects immediately.
   */
  connect(): void {
    if (this.disposed) {
      throw new SyncTransportError(
        'TRANSPORT_DISPOSED',
        'Cannot connect: transport has been disposed',
      );
    }

    // Cancel any pending reconnect
    this.clearReconnectTimer();

    if (
      this.connectionState === WS_CONNECTION_STATE.CONNECTED ||
      this.connectionState === WS_CONNECTION_STATE.CONNECTING
    ) {
      return;
    }

    this.intentionalClose = false;
    this.setConnectionState(WS_CONNECTION_STATE.CONNECTING);
    this.createConnection();
  }

  /**
   * Gracefully close the WebSocket connection.
   *
   * This stops reconnection attempts, cancels heartbeats,
   * and rejects all pending requests.
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.rejectAllPending(new SyncTransportError(
      'DISCONNECTED',
      'Transport disconnected by client',
    ));
    this.closeWs();
    this.setConnectionState(WS_CONNECTION_STATE.DISCONNECTED);
  }

  /**
   * Permanently dispose of the transport.
   *
   * After disposal, no further operations are permitted.
   */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.setConnectionState(WS_CONNECTION_STATE.DISPOSED);
    this.connectionStateListeners.clear();
    this.pushListeners.clear();
  }

  // ----------------------------------------------------------------
  // Event subscription
  // ----------------------------------------------------------------

  /**
   * Register a callback for connection state changes.
   * Returns a cleanup function to remove the listener.
   */
  onConnectionStateChange(callback: OnConnectionStateChange): () => void {
    this.connectionStateListeners.add(callback);
    return () => {
      this.connectionStateListeners.delete(callback);
    };
  }

  /**
   * Register a callback for server-pushed changes.
   * Returns a cleanup function to remove the listener.
   */
  onPush(callback: OnPushChanges): () => void {
    this.pushListeners.add(callback);
    return () => {
      this.pushListeners.delete(callback);
    };
  }

  /**
   * The current connection state.
   */
  get state(): WsConnectionState {
    return this.connectionState;
  }

  // ----------------------------------------------------------------
  // SyncTransport interface
  // ----------------------------------------------------------------

  /**
   * Negotiate protocol version over WebSocket.
   *
   * Sends a `version:negotiate` message and waits for the
   * `version:response` from the server.
   */
  async negotiateVersion(clientVersions: readonly string[]): Promise<VersionInfo> {
    const id = this.nextMessageId();
    const msg = {
      type: WS_MSG_TYPE.VERSION_NEGOTIATION,
      id,
      clientVersions: [...clientVersions],
    } satisfies WsClientMessage;

    const response = await this.request(msg);

    // The response is the full server message; extract fields.
    const serverMsg = response as {
      version: string;
      serverSupportedVersions: string[];
    };

    if (
      typeof serverMsg.version !== 'string' ||
      !Array.isArray(serverMsg.serverSupportedVersions)
    ) {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.INVALID_REQUEST,
        'Invalid version negotiation response from server',
      );
    }

    return {
      version: serverMsg.version,
      serverSupportedVersions: serverMsg.serverSupportedVersions,
    };
  }

  /**
   * Send an incremental sync request over WebSocket.
   */
  async sendSyncRequest(request: SyncRequest): Promise<SyncResponse> {
    const id = this.nextMessageId();
    const msg = {
      type: WS_MSG_TYPE.SYNC_REQUEST,
      id,
      request,
    } satisfies WsClientMessage;

    const response = await this.request(msg);

    if (!isSyncResponse(response)) {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.INVALID_REQUEST,
        'Invalid sync response from server',
      );
    }

    return response;
  }

  /**
   * Send a snapshot sync request over WebSocket.
   */
  async sendSnapshotRequest(
    request: SnapshotRequest,
  ): Promise<SnapshotResponse> {
    const id = this.nextMessageId();
    const msg = {
      type: WS_MSG_TYPE.SNAPSHOT_REQUEST,
      id,
      request,
    } satisfies WsClientMessage;

    const response = await this.request(msg);

    if (!isSnapshotResponse(response)) {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.INVALID_REQUEST,
        'Invalid snapshot response from server',
      );
    }

    return response;
  }

  // ----------------------------------------------------------------
  // Internal: connection management
  // ----------------------------------------------------------------

  private createConnection(): void {
    this.ws = this.wsFactory(this.url);

    this.ws.addEventListener('open', this.handleOpen);
    this.ws.addEventListener('message', this.handleMessage);
    this.ws.addEventListener('close', this.handleClose);
    this.ws.addEventListener('error', this.handleError);
  }

  private closeWs(): void {
    const ws = this.ws;
    this.ws = null;

    if (ws !== null) {
      // Close first so event handlers fire (needed for reconnection logic).
      // Only call close if the socket is still open or connecting.
      if (
        ws.readyState === 0 || // CONNECTING
        ws.readyState === 1 // OPEN
      ) {
        ws.close(1000, 'Client disconnect');
      }

      ws.removeEventListener('open', this.handleOpen);
      ws.removeEventListener('message', this.handleMessage);
      ws.removeEventListener('close', this.handleClose);
      ws.removeEventListener('error', this.handleError);
    }
  }

  private onOpen(): void {
    this.reconnectAttempt = 0;
    this.setConnectionState(WS_CONNECTION_STATE.CONNECTED);
    this.startHeartbeat();
  }

  private onClose(_event: Event): void {
    this.stopHeartbeat();
    this.ws = null;

    if (this.disposed || this.intentionalClose) {
      if (this.connectionState !== WS_CONNECTION_STATE.DISPOSED) {
        this.setConnectionState(WS_CONNECTION_STATE.DISCONNECTED);
      }
      return;
    }

    // Unintentional close — schedule reconnection
    this.scheduleReconnect();
  }

  private onError(_event: Event): void {
    // The 'error' event is always followed by 'close'.
    // We handle reconnection in onClose, so nothing to do here.
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalClose) {
      return;
    }

    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectAttempt >= this.maxReconnectAttempts
    ) {
      this.setConnectionState(WS_CONNECTION_STATE.DISCONNECTED);
      return;
    }

    this.setConnectionState(WS_CONNECTION_STATE.RECONNECTING);

    const delay = this.calculateReconnectDelay();
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setConnectionState(WS_CONNECTION_STATE.CONNECTING);
      this.createConnection();
    }, delay);
  }

  private calculateReconnectDelay(): number {
    const delay =
      this.reconnectBaseDelayMs *
      Math.pow(this.reconnectMultiplier, this.reconnectAttempt);
    return Math.min(delay, this.reconnectMaxDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ----------------------------------------------------------------
  // Internal: message handling
  // ----------------------------------------------------------------

  private onMessage(event: Event): void {
    const messageEvent = event as MessageEvent;
    let parsed: unknown;

    try {
      parsed = JSON.parse(String(messageEvent.data));
    } catch {
      // Malformed JSON — ignore
      return;
    }

    if (!isWsServerMessage(parsed)) {
      return;
    }

    switch (parsed.type) {
      case WS_MSG_TYPE.SYNC_RESPONSE:
      case WS_MSG_TYPE.SNAPSHOT_RESPONSE:
      case WS_MSG_TYPE.VERSION_RESPONSE:
        this.handleResponse(parsed);
        break;

      case WS_MSG_TYPE.PUSH_CHANGES:
        this.handlePush(parsed);
        break;

      case WS_MSG_TYPE.PONG:
        this.handlePong(parsed);
        break;

      case WS_MSG_TYPE.ERROR:
        this.handleServerError(parsed);
        break;
    }
  }

  private handleResponse(msg: WsServerMessage): void {
    // Extract the correlation ID and resolve the pending request
    const id = this.getResponseId(msg);
    if (id === undefined) {
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (pending === undefined) {
      return;
    }

    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);

    // Extract the payload from the framed message
    const payload = this.extractPayload(msg);
    pending.resolve(payload);
  }

  private handleServerError(msg: WsErrorMsg): void {
    // If the error correlates to a pending request, reject it
    if (msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending !== undefined) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        pending.reject(
          new SyncTransportError(msg.code, msg.message, msg.details),
        );
        return;
      }
    }

    // Otherwise, the error is a top-level connection error.
    // Reject all pending requests.
    const error = new SyncTransportError(msg.code, msg.message, msg.details);
    this.rejectAllPending(error);
  }

  private handlePush(msg: WsPushChangesMsg): void {
    // Validate that each item in changes is actually a Change
    const validChanges = msg.changes.filter((c): c is Change => isChange(c));
    if (validChanges.length === 0) {
      return;
    }

    for (const listener of this.pushListeners) {
      listener(validChanges, msg.cursor);
    }
  }
  
  // ----------------------------------------------------------------
  // Internal: heartbeat
  // ----------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();

    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
  }

  private sendPing(): void {
    const msg: WsClientMessage = {
      type: WS_MSG_TYPE.PING,
      timestamp: Date.now(),
    };
    this.sendRaw(msg);

    // Start a timer to detect if PONG is not received
    this.clearPongTimer();
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      // PONG not received in time — connection is stale
      this.closeWs();
      // onClose will handle reconnection
    }, this.pongTimeoutMs);
  }

  private handlePong(_msg: WsPongMsg): void {
    this.clearPongTimer();
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // ----------------------------------------------------------------
  // Internal: request/response correlation
  // ----------------------------------------------------------------

  /**
   * Send a message and return a promise that resolves when the
   * matching response arrives.
   *
   * If the connection is not open, the promise rejects immediately.
   */
  private request(msg: WsClientMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws === null || this.ws.readyState !== 1) {
        reject(
          new SyncTransportError(
            'NOT_CONNECTED',
            'WebSocket is not connected',
          ),
        );
        return;
      }

      // Version negotiation doesn't have an `id` field
      const id = 'id' in msg ? (msg as { id: string }).id : undefined;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id ?? '_negotiate_');
        reject(
          new SyncTransportError(
            'TIMEOUT',
            'Request timed out waiting for server response',
          ),
        );
      }, 30_000);

      const key = id ?? '_negotiate_';
      this.pendingRequests.set(key, { resolve, reject, timer });
      this.sendRaw(msg);
    });
  }

  private sendRaw(msg: WsClientMessage): void {
    if (this.ws === null || this.ws.readyState !== 1) {
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  // ----------------------------------------------------------------
  // Internal: helpers
  // ----------------------------------------------------------------

  private nextMessageId(): string {
    this.messageIdCounter++;
    return `ws-${this.messageIdCounter}`;
  }

  private getResponseId(
    msg: WsServerMessage,
  ): string | undefined {
  if ('id' in msg && typeof msg.id === 'string') {
    return msg.id;
  }
  return undefined;
  }

  private extractPayload(msg: WsServerMessage): unknown {
  if ('response' in msg) {
    return (msg as { response: unknown }).response;
  }
  if ('version' in msg && 'serverSupportedVersions' in msg) {
    return {
      version: (msg as { version: string }).version,
      serverSupportedVersions: (msg as { serverSupportedVersions: string[] })
        .serverSupportedVersions,
    };
  }
  return msg;
  }

  private setConnectionState(state: WsConnectionState): void {
    if (this.connectionState === state) {
      return;
    }
    this.connectionState = state;
    for (const listener of this.connectionStateListeners) {
      listener(state);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [key, pending] of this.pendingRequests) {
      this.pendingRequests.delete(key);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

// -------------------------------------------------------------------
// Default WebSocket factory (browser)
// -------------------------------------------------------------------

function defaultWsFactory(url: string): MinimalWebSocket {
  // In environments where globalThis.WebSocket exists (browsers, Deno),
  // use it directly. In Node.js, the caller should provide a factory.
  if (typeof globalThis.WebSocket !== 'undefined') {
    return new globalThis.WebSocket(url) as unknown as MinimalWebSocket;
  }
  throw new SyncTransportError(
    'NO_WEBSOCKET',
    'No WebSocket implementation available. Provide a wsFactory option.',
  );
}
