/**
 * Collection state management logic.
 *
 * Plain functions that manage collection state for the useCollection hook.
 * Extracted for testability without React dependencies.
 */

import type { Entity, SyncState } from '@offlinesync/core';
import type {
  CollectionDataSource,
  UseCollectionResult,
} from './types.js';
import { SYNC_STATE } from '@offlinesync/core';

/**
 * Internal mutable state for a collection.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
interface CollectionStateInternal<T> {
  entities: readonly Entity<T>[];
  isLoading: boolean;
  error: Error | null;
  syncState: SyncState;
}

/**
 * Options for creating a collection controller.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface CollectionControllerOptions<T> {
  /** Called whenever the internal state changes. */
  readonly onStateChange?: (state: UseCollectionResult<T>) => void;
}

/**
 * Controller that manages collection state and subscriptions.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface CollectionController<T> {
  /** Get the current state snapshot. */
  readonly state: UseCollectionResult<T>;
  /** Trigger a refresh of the entity list. */
  refresh(): Promise<void>;
  /** Dispose all subscriptions and stop listening. */
  dispose(): void;
}

/**
 * Create the initial collection state.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @returns A fresh state object with loading true and no entities.
 */
export function createInitialCollectionState<T>(): UseCollectionResult<T> {
  return {
    entities: [],
    isLoading: true,
    error: null,
    syncState: SYNC_STATE.LOCAL_ONLY,
  };
}

/**
 * Create a collection controller that manages state and subscriptions.
 *
 * The controller immediately starts fetching and subscribing
 * to changes when created.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param dataSource - The collection data source to read from.
 * @returns A controller with state access, refresh, and dispose.
 */
export function createCollectionController<T>(
  dataSource: CollectionDataSource<T>,
  options?: CollectionControllerOptions<T>,
): CollectionController<T> {
  const internalState: CollectionStateInternal<T> = {
    entities: [],
    isLoading: true,
    error: null,
    syncState: SYNC_STATE.LOCAL_ONLY,
  };

  const onStateChange = options?.onStateChange;
  let subscription: { dispose(): void } | null = null;
  let disposed = false;

  function getState(): UseCollectionResult<T> {
    return {
      entities: internalState.entities,
      isLoading: internalState.isLoading,
      error: internalState.error,
      syncState: internalState.syncState,
    };
  }

  function notifyStateChange(): void {
    if (onStateChange !== undefined) {
      onStateChange(getState());
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;

    internalState.isLoading = true;
    internalState.error = null;
    notifyStateChange();

    try {
      const loadedEntities = await dataSource.getAll();
      if (!disposed) {
        internalState.entities = loadedEntities;
        internalState.isLoading = false;
        internalState.syncState = dataSource.getSyncState();
        notifyStateChange();
      }
    } catch (error) {
      if (!disposed) {
        internalState.error =
          error instanceof Error ? error : new Error(String(error));
        internalState.isLoading = false;
        notifyStateChange();
      }
    }
  }

  function subscribe(): void {
    if (disposed) return;

    subscription = dataSource.subscribeToChanges(() => {
      void refresh();
    });
  }

  function dispose(): void {
    disposed = true;
    if (subscription !== null) {
      subscription.dispose();
      subscription = null;
    }
  }

  // Start immediately
  subscribe();
  void refresh();

  return {
    get state() {
      return getState();
    },
    refresh,
    dispose,
  };
}

/**
 * Handle a collection change event by marking the controller
 * as needing a refresh.
 *
 * This is a pure function for testing state transitions.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @param newEntities - The updated entities after the change.
 * @returns A new state with updated entities and loading false.
 */
export function handleCollectionEntitiesLoaded<T>(
  currentState: UseCollectionResult<T>,
  newEntities: readonly Entity<T>[],
): UseCollectionResult<T> {
  return {
    entities: newEntities,
    isLoading: false,
    error: null,
    syncState: currentState.syncState,
  };
}

/**
 * Handle a collection fetch error.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @param error - The error that occurred.
 * @returns A new state with the error set and loading false.
 */
export function handleCollectionError<T>(
  currentState: UseCollectionResult<T>,
  error: Error,
): UseCollectionResult<T> {
  return {
    entities: currentState.entities,
    isLoading: false,
    error,
    syncState: currentState.syncState,
  };
}

/**
 * Handle a sync state change for a collection.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @param newSyncState - The updated sync state.
 * @returns A new state with the updated sync state.
 */
export function handleCollectionSyncStateChange<T>(
  currentState: UseCollectionResult<T>,
  newSyncState: SyncState,
): UseCollectionResult<T> {
  return {
    entities: currentState.entities,
    isLoading: currentState.isLoading,
    error: currentState.error,
    syncState: newSyncState,
  };
}
