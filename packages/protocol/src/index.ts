/**
 * @offlinesync/protocol
 *
 * Language-independent wire protocol types and validation.
 * This package is fully independent — it imports nothing from other
 * OfflineSync packages.
 *
 * Type domain: Protocol.
 * Boundary rule: NO type from this package crosses into client or server domains.
 */

// --- Core type constants ---
export {
  SYNC_ERROR_CODE,
  ERROR_CLASSIFICATION,
} from './types.js';
export type {
  SyncErrorCode,
  ErrorClassification,
} from './types.js';

// --- Protocol mutation ---
export type { ProtocolMutation } from './mutation.js';

// --- Incremental sync ---
export type {
  SyncRequest,
  SyncResponse,
  Change,
  ConflictInfo,
  ProtocolEntity,
} from './sync.js';

// --- Snapshot sync ---
export type {
  SnapshotRequest,
  SnapshotResponse,
} from './snapshot.js';

// --- Error response ---
export type { ProtocolError } from './error.js';
export {
  ERROR_CODE_CLASSIFICATION,
  ERROR_CODE_HTTP_STATUS,
  CLASSIFICATION_RETRY_BEHAVIOR,
} from './error.js';

// --- Handshake and version negotiation ---
export {
  CURRENT_PROTOCOL_VERSION,
  negotiateVersion,
  parseVersion,
} from './handshake.js';
export type { ProtocolVersion } from './handshake.js';

// --- Runtime validation (type guards) ---
export {
  isProtocolEntity,
  isProtocolMutation,
  isChange,
  isConflictInfo,
  isSyncRequest,
  isSyncResponse,
  isSnapshotRequest,
  isSnapshotResponse,
  isProtocolError,
  isSyncErrorCode,
  isErrorClassification,
} from './validation.js';