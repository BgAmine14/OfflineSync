/**
 * Sync state management logic for Vue composables.
 *
 * Plain functions that manage sync state for the useSyncState composable.
 * Extracted for testability without Vue dependencies.
 */

import type { SyncState } from '@offlinesync/core';
import { SYNC_STATE } from '@offlinesync/core';
import type { SyncStateSource } from './types.js';

/**
 * Controller that tracks sync state changes.
 */
export interface SyncStateController {
  /** Get the current sync state. */
  readonly state: SyncState;
  /** Dispose the change listener. */
  dispose(): void;
}

/**
 * Create a sync state controller.
 *
 * @param source - The sync state data source.
 * @returns A controller with state access and dispose.
 */
export function createSyncStateController(
  source: SyncStateSource,
): SyncStateController {
  let currentState: SyncState = source.getSyncState();
  let cleanup: (() => void) | null = null;

  function getState(): SyncState {
    return currentState;
  }

  function subscribe(): void {
    cleanup = source.onStateChange((newState) => {
      currentState = newState;
    });
  }

  function dispose(): void {
    if (cleanup !== null) {
      cleanup();
      cleanup = null;
    }
  }

  // Start immediately
  subscribe();

  return {
    get state() {
      return getState();
    },
    dispose,
  };
}

/**
 * Get the default (initial) sync state.
 *
 * @returns The LOCAL_ONLY sync state.
 */
export function getDefaultSyncState(): SyncState {
  return SYNC_STATE.LOCAL_ONLY;
}

/**
 * Create a sync state change handler that produces a new state.
 *
 * This is a pure function useful for testing state transitions.
 *
 * @param previousState - The previous sync state.
 * @param newState - The new sync state.
 * @returns The new sync state.
 */
export function handleSyncStateChange(
  previousState: SyncState,
  newState: SyncState,
): SyncState {
  if (previousState === newState) {
    return previousState;
  }
  return newState;
}
