/**
 * React hook for reading the current sync state.
 *
 * Returns the sync state of the SyncEngine provided
 * by the OfflineSyncProvider context.
 */

import type { SyncState } from '@offlinesync/core';
import type { SyncStateSource } from './types.js';
import { useOfflineSyncContext } from './sync-context.js';
import { SYNC_STATE } from '@offlinesync/core';

/**
 * React hook for reading the current sync state.
 *
 * @returns The current sync state of the SyncEngine.
 * @throws {Error} if used outside an OfflineSyncProvider.
 */
export function useSyncState(): SyncState {
  const { engine } = useOfflineSyncContext();
  return engine.syncState;
}

/**
 * Get a sync state source from an engine for use with
 * the plain logic layer.
 *
 * @param engine - The sync engine to observe.
 * @returns A sync state source suitable for createSyncStateController.
 */
export function createEngineSyncStateSource(engine: {
  readonly syncState: SyncState;
  onConflict(callback: (event: unknown) => void): void;
}): SyncStateSource {
  return {
    getSyncState: () => engine.syncState,
    onStateChange: () => {
      // SyncEngine does not currently emit state change events.
      // Consumers should poll or use the SyncScheduler's onSyncComplete.
      return () => {
        /* noop */
      };
    },
  };
}

/**
 * Create a default sync state result when no engine is available.
 *
 * @returns The default sync state.
 */
export function getDefaultSyncStateResult(): SyncState {
  return SYNC_STATE.LOCAL_ONLY;
}
