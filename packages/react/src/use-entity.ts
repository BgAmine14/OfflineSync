/**
 * React hook for observing a single entity.
 *
 * Subscribes to the collection's change events and returns
 * the requested entity, loading state, and error.
 */

import * as React from 'react';
import type { UseEntityResult } from './types.js';
import type { EntityDataSource } from './types.js';
import { useOfflineSyncContext } from './sync-context.js';
import { createEntityController, createInitialEntityState } from './entity-logic.js';

/**
 * React hook for observing a single entity.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param collectionName - The name of the collection.
 * @param entityId - The ID of the entity to observe.
 * @returns The current entity state.
 * @throws {Error} if used outside an OfflineSyncProvider.
 */
export function useEntity<T>(
  collectionName: string,
  entityId: string,
): UseEntityResult<T> {
  const { getCollection } = useOfflineSyncContext();

  const [state, setState] = React.useState<UseEntityResult<T>>(
    createInitialEntityState<T>(),
  );

  const dataSource: EntityDataSource<T> | undefined = React.useMemo(
    () => {
      const collection = getCollection<T>(collectionName);
      if (collection === undefined) return undefined;
      return {
        get: (id) => collection.getOrNull(id),
        subscribeToChanges: (callback) => collection.subscribe(callback),
      };
    },
    [getCollection, collectionName],
  );

  const controller = React.useMemo(
    () =>
      dataSource !== undefined
        ? createEntityController<T>(dataSource, entityId, {
            onStateChange: (newState) => setState(newState),
          })
        : null,
    [dataSource, entityId],
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
    entity: null,
    isLoading: false,
    error: null,
  };
}
