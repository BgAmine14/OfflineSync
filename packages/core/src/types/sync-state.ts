/**
 * Sync state types for the client-side sync engine.
 *
 * This reflects the SYNC RELATIONSHIP with the server,
 * not network status.
 *
 * OFFLINE is NOT a sync state. OFFLINE means no network.
 * A client can be CONNECTED but not SYNCED (pending mutations).
 * A client can be SYNCED and then go offline — it remains SYNCED
 *   because SyncState reflects the sync relationship, not network status.
 */

/**
 * Represents the sync state of a collection or the overall engine.
 */
export const SYNC_STATE = {
  /** No sync has been attempted */
  LOCAL_ONLY: 'LOCAL_ONLY',
  /** Attempting to connect to server */
  CONNECTING: 'CONNECTING',
  /** Connected, not yet syncing */
  CONNECTED: 'CONNECTED',
  /** Actively exchanging changes */
  SYNCING: 'SYNCING',
  /** All changes synced */
  SYNCED: 'SYNCED',
  /** Sync error, will retry based on classification */
  ERROR: 'ERROR',
} as const;

export type SyncState = (typeof SYNC_STATE)[keyof typeof SYNC_STATE];
