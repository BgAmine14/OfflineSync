/**
 * Vue composable for observing a single entity.
 *
 * Subscribes to the collection's change events and returns
 * the requested entity, loading state, and error.
 */

import * as Vue from 'vue';
import type { UseEntityResult, EntityDataSource } from './types.js';
import type { Entity } from '@offlinesync/core';
import { useOfflineSyncContext } from './sync-injection.js';
import { createEntityController } from './entity-logic.js';

/**
 * Vue composable for observing a single entity.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param collectionName - The name of the collection.
 * @param entityId - The ID of the entity to observe.
 * @returns A reactive object with the current entity state.
 * @throws {Error} if used outside a component that provides OfflineSync.
 */
export function useEntity<T>(
  collectionName: string,
  entityId: string,
): UseEntityResult<T> {
  const { getCollection } = useOfflineSyncContext();

  const entity = Vue.ref<Entity<T> | null>(null);
  const isLoading = Vue.ref(true);
  const error = Vue.ref<Error | null>(null);

  let controller: ReturnType<typeof createEntityController<unknown>> | null = null;

  const collection = getCollection<T>(collectionName);
  if (collection !== undefined) {
    const dataSource: EntityDataSource<T> = {
      get: (id) => collection.getOrNull(id),
      subscribeToChanges: (callback) => collection.subscribe(callback),
    };

    controller = createEntityController<T>(dataSource, entityId, {
      onStateChange: (newState) => {
        entity.value = newState.entity;
        isLoading.value = newState.isLoading;
        error.value = newState.error;
      },
    });
  }

  Vue.onUnmounted(() => {
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
  });

  return {
    entity: entity.value,
    isLoading: isLoading.value,
    error: error.value,
  };
}
