/**
 * WebSocket message framing.
 *
 * All messages sent over the WebSocket are JSON objects with a `type` field
 * that discriminates the message kind. This file defines the wire format
 * for both client→server and server→client messages.
 */

import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
  Change,
} from '@offlinesync/protocol';

// -------------------------------------------------------------------
// Message type discriminators
// -------------------------------------------------------------------

/** Client→server: request version negotiation. */
export const WS_MSG_TYPE = {
  VERSION_NEGOTIATION: 'version:negotiate' as const,
  SYNC_REQUEST: 'sync:request' as const,
  SNAPSHOT_REQUEST: 'snapshot:request' as const,
  PING: 'ping' as const,
  PONG: 'pong' as const,
  VERSION_RESPONSE: 'version:response' as const,
  SYNC_RESPONSE: 'sync:response' as const,
  SNAPSHOT_RESPONSE: 'snapshot:response' as const,
  PUSH_CHANGES: 'push:changes' as const,
  ERROR: 'error' as const,
};

// -------------------------------------------------------------------
// Client → Server messages
// -------------------------------------------------------------------

export interface WsVersionNegotiateMsg {
  readonly type: typeof WS_MSG_TYPE.VERSION_NEGOTIATION;
  readonly id: string;
  readonly clientVersions: readonly string[];
}

export interface WsSyncRequestMsg {
  readonly type: typeof WS_MSG_TYPE.SYNC_REQUEST;
  readonly id: string;
  readonly request: SyncRequest;
}

export interface WsSnapshotRequestMsg {
  readonly type: typeof WS_MSG_TYPE.SNAPSHOT_REQUEST;
  readonly id: string;
  readonly request: SnapshotRequest;
}

export interface WsPingMsg {
  readonly type: typeof WS_MSG_TYPE.PING;
  readonly timestamp: number;
}

// -------------------------------------------------------------------
// Server → Client messages
// -------------------------------------------------------------------

export interface WsVersionResponseMsg {
  readonly type: typeof WS_MSG_TYPE.VERSION_RESPONSE;
  readonly id: string;
  readonly version: string;
  readonly serverSupportedVersions: string[];
}

export interface WsSyncResponseMsg {
  readonly type: typeof WS_MSG_TYPE.SYNC_RESPONSE;
  readonly id: string;
  readonly response: SyncResponse;
}

export interface WsSnapshotResponseMsg {
  readonly type: typeof WS_MSG_TYPE.SNAPSHOT_RESPONSE;
  readonly id: string;
  readonly response: SnapshotResponse;
}

export interface WsPongMsg {
  readonly type: typeof WS_MSG_TYPE.PONG;
  readonly timestamp: number;
}

/** Server pushes changes to the client in real time. */
export interface WsPushChangesMsg {
  readonly type: typeof WS_MSG_TYPE.PUSH_CHANGES;
  readonly changes: readonly Change[];
  readonly cursor: string;
}

export interface WsErrorMsg {
  readonly type: typeof WS_MSG_TYPE.ERROR;
  readonly id?: string;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

// -------------------------------------------------------------------
// Union types
// -------------------------------------------------------------------

export type WsClientMessage =
  | WsVersionNegotiateMsg
  | WsSyncRequestMsg
  | WsSnapshotRequestMsg
  | WsPingMsg;

export type WsServerMessage =
  | WsVersionResponseMsg
  | WsSyncResponseMsg
  | WsSnapshotResponseMsg
  | WsPongMsg
  | WsPushChangesMsg
  | WsErrorMsg;

// -------------------------------------------------------------------
// Type guards
// -------------------------------------------------------------------

export function isWsServerMessage(value: unknown): value is WsServerMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as Record<string, unknown>)['type'];
  return (
    type === WS_MSG_TYPE.VERSION_RESPONSE ||
    type === WS_MSG_TYPE.SYNC_RESPONSE ||
    type === WS_MSG_TYPE.SNAPSHOT_RESPONSE ||
    type === WS_MSG_TYPE.PONG ||
    type === WS_MSG_TYPE.PUSH_CHANGES ||
    type === WS_MSG_TYPE.ERROR
  );
}
