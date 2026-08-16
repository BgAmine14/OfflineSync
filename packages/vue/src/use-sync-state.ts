/**
 * Vue composable for reading the current sync state.
 *
 * Returns the sync state of the SyncEngine provided
 * by the OfflineSync injection context.
 */

import type { SyncState } from '@offlinesync/core';
import { useOfflineSyncContext } from './sync-injection.js';
import { getDefaultSyncState } from './sync-state-logic.js';

/**
 * Vue composable for reading the current sync state.
 *
 * @returns The current sync state of the SyncEngine.
 * @throws {Error} if used outside a component that provides OfflineSync.
 */
export function useSyncState(): SyncState {
  const { engine } = useOfflineSyncContext();
  return engine.syncState;
}

/**
 * Get the default sync state result when no engine is available.
 *
 * @returns The default sync state.
 */
export function getDefaultSyncStateResult(): SyncState {
  return getDefaultSyncState();
}
