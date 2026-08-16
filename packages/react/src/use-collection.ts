/**
 * React hook for observing a collection.
 *
 * Subscribes to collection changes and returns the current
 * entities, loading state, error, and sync state.
 */

import * as React from 'react';
import type { UseCollectionResult, CollectionHookOptions } from './types.js';
import type { CollectionDataSource } from './types.js';
import { useOfflineSyncContext } from './sync-context.js';
import { createCollectionController, createInitialCollectionState } from './collection-logic.js';
import { SYNC_STATE } from '@offlinesync/core';

/**
 * React hook for observing a collection's entities.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param collectionName - The name of the collection to observe.
 * @param options - Optional hook configuration.
 * @returns The current collection state.
 * @throws {Error} if used outside an OfflineSyncProvider.
 */
export function useCollection<T>(
  collectionName: string,
  options?: CollectionHookOptions,
): UseCollectionResult<T> {
  const { getCollection } = useOfflineSyncContext();
  const enabled = options?.enabled ?? true;

  const [state, setState] = React.useState<UseCollectionResult<T>>(
    createInitialCollectionState<T>(),
  );

  const dataSource: CollectionDataSource<T> | undefined = React.useMemo(
    () => {
      if (!enabled) return undefined;
      const collection = getCollection<T>(collectionName);
      if (collection === undefined) return undefined;
      return {
        getAll: () => collection.query(collection.createQuery()),
        subscribeToChanges: (callback) => collection.subscribe(callback),
        getSyncState: () => collection.syncState,
      };
    },
    [getCollection, collectionName, enabled],
  );

  const controller = React.useMemo(
    () =>
      dataSource !== undefined
        ? createCollectionController<T>(dataSource, {
            onStateChange: (newState) => setState(newState),
          })
        : null,
    [dataSource],
  );

  React.useEffect(() => {
    return () => {
      if (controller !== null) {
        controller.dispose();
      }
    };
  }, [controller]);

  if (controller !== null) {
    return state;
  }

  return {
    entities: [],
    isLoading: false,
    error: null,
    syncState: SYNC_STATE.LOCAL_ONLY,
  };
}
