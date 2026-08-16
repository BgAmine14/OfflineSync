/**
 * Vue composable for observing a collection.
 *
 * Subscribes to collection changes and returns the current
 * entities, loading state, error, and sync state.
 */

import * as Vue from 'vue';
import type { UseCollectionResult, CollectionComposableOptions, CollectionDataSource } from './types.js';
import type { Entity, SyncState } from '@offlinesync/core';
import { useOfflineSyncContext } from './sync-injection.js';
import { createCollectionController } from './collection-logic.js';
import { SYNC_STATE } from '@offlinesync/core';

/**
 * Vue composable for observing a collection's entities.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param collectionName - The name of the collection to observe.
 * @param options - Optional composable configuration.
 * @returns A reactive object with the current collection state.
 * @throws {Error} if used outside a component that provides OfflineSync.
 */
export function useCollection<T>(
  collectionName: string,
  options?: CollectionComposableOptions,
): UseCollectionResult<T> {
  const { getCollection } = useOfflineSyncContext();
  const enabled = options?.enabled ?? true;

  const entities = Vue.ref<readonly Entity<T>[]>([]);
  const isLoading = Vue.ref(true);
  const error = Vue.ref<Error | null>(null);
  const syncState = Vue.ref<SyncState>(SYNC_STATE.LOCAL_ONLY);

  let controller: ReturnType<typeof createCollectionController<unknown>> | null = null;

  if (enabled) {
    const collection = getCollection<T>(collectionName);
    if (collection !== undefined) {
      const dataSource: CollectionDataSource<T> = {
        getAll: () => collection.query(collection.createQuery()),
        subscribeToChanges: (callback) => collection.subscribe(callback),
        getSyncState: () => collection.syncState,
      };

      controller = createCollectionController<T>(dataSource, {
        onStateChange: (newState) => {
          entities.value = newState.entities;
          isLoading.value = newState.isLoading;
          error.value = newState.error;
          syncState.value = newState.syncState;
        },
      });
    }
  }

  Vue.onUnmounted(() => {
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
  });

  return {
    entities: entities.value,
    isLoading: isLoading.value,
    error: error.value,
    syncState: syncState.value,
  };
}
