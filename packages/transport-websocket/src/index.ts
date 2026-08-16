/**
 * @offlinesync/transport-websocket
 *
 * Real-time bidirectional WebSocket transport for the OfflineSync
 * sync protocol.
 *
 * @example
 * ```typescript
 * import { WebSocketSyncTransport } from '@offlinesync/transport-websocket';
 *
 * const transport = new WebSocketSyncTransport({
 *   url: 'wss://api.example.com/sync',
 * });
 *
 * transport.onPush((changes, cursor) => {
 *   console.log(`Received ${changes.length} pushed changes`);
 * });
 *
 * await transport.connect();
 * ```
 */

export {
  WebSocketSyncTransport,
  WS_CONNECTION_STATE,
  type WebSocketTransportOptions,
  type WsConnectionState,
  type OnConnectionStateChange,
  type OnPushChanges,
  type MinimalWebSocket,
  type WebSocketFactory,
} from './ws-transport.js';

export {
  WS_MSG_TYPE,
  type WsClientMessage,
  type WsServerMessage,
  type WsVersionNegotiateMsg,
  type WsSyncRequestMsg,
  type WsSnapshotRequestMsg,
  type WsPingMsg,
  type WsVersionResponseMsg,
  type WsSyncResponseMsg,
  type WsSnapshotResponseMsg,
  type WsPongMsg,
  type WsPushChangesMsg,
  type WsErrorMsg,
  isWsServerMessage,
} from './ws-types.js';
