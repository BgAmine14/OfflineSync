/**
 * Snapshot sync request and response types.
 *
 * Snapshot sync is a first-class protocol operation, not a fallback.
 * It is used for:
 * 1. Initial sync (client has no cursor)
 * 2. CURSOR_TOO_OLD recovery
 * 3. Manual full re-sync
 */

// Re-export ProtocolEntity for consumers who only import from snapshot
export type { ProtocolEntity } from './sync.js';

/**
 * Request for a full data snapshot.
 */
export interface SnapshotRequest {
  /**
   * Optional: filter by collection names.
   * If omitted or empty, all collections are included.
   */
  collections?: string[];

  /** Client identifier */
  clientId: string;
}

/**
 * Response containing a full data snapshot.
 *
 * After receiving and applying a snapshot, the client:
 * 1. Replaces local state with the snapshot data.
 * 2. Resets its cursor to `cursor`.
 * 3. Performs an incremental sync to catch any changes
 *    that occurred during the snapshot transfer.
 */
export interface SnapshotResponse {
  /**
   * All entities grouped by collection name.
   * The value is `unknown[]` because the protocol is
   * language-independent — the client is responsible for
   * casting to the appropriate type.
   */
  entities: Record<string, unknown[]>;

  /**
   * Cursor position at the time of the snapshot.
   * The client should use this as its new cursor.
   */
  cursor: string;

  /** ISO 8601 timestamp of when the snapshot was generated */
  serverTimestamp: string;
}
