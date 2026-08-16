/**
 * @offlinesync/server
 *
 * In-memory reference sync server for OfflineSync.
 * This is a reference implementation for testing and documentation.
 *
 * Type domain: Server.
 * Depends on: @offlinesync/protocol (types only at boundary).
 */

// --- Change log ---
export { ServerChangeLog } from './change-log.js';
export type { ChangeLogEntry } from './change-log.js';

// --- Mutation tracker ---
export { ServerMutationTracker } from './mutation-tracker.js';

// --- Sync server ---
export { SyncServer } from './sync-server.js';
