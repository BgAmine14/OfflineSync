/**
 * Entity state management logic for Vue composables.
 *
 * Plain functions that manage single-entity state for the useEntity composable.
 * Extracted for testability without Vue dependencies.
 */

import type { Entity } from '@offlinesync/core';
import type { UseEntityResult, EntityDataSource } from './types.js';

/**
 * Options for creating an entity controller.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface EntityControllerOptions<T> {
  /** Called whenever the internal state changes. */
  readonly onStateChange?: (state: UseEntityResult<T>) => void;
}

/**
 * Controller that manages single-entity state and subscriptions.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface EntityController<T> {
  /** Get the current state snapshot. */
  readonly state: UseEntityResult<T>;
  /** Trigger a refresh of the entity. */
  refresh(): Promise<void>;
  /** Dispose all subscriptions and stop listening. */
  dispose(): void;
}

/**
 * Create the initial entity state.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @returns A fresh state object with loading true and no entity.
 */
export function createInitialEntityState<T>(): UseEntityResult<T> {
  return {
    entity: null,
    isLoading: true,
    error: null,
  };
}

/**
 * Create an entity controller that manages state and subscriptions.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param dataSource - The entity data source to read from.
 * @param entityId - The ID of the entity to manage.
 * @returns A controller with state access, refresh, and dispose.
 */
export function createEntityController<T>(
  dataSource: EntityDataSource<T>,
  entityId: string,
  options?: EntityControllerOptions<T>,
): EntityController<T> {
  let entity: Entity<T> | null = null;
  let isLoading = true;
  let error: Error | null = null;
  const onStateChange = options?.onStateChange;
  let subscription: { dispose(): void } | null = null;
  let disposed = false;

  function getState(): UseEntityResult<T> {
    return {
      entity,
      isLoading,
      error,
    };
  }

  function notifyStateChange(): void {
    if (onStateChange !== undefined) {
      onStateChange(getState());
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;

    isLoading = true;
    error = null;
    notifyStateChange();

    try {
      const result = await dataSource.get(entityId);
      if (!disposed) {
        entity = result;
        isLoading = false;
        notifyStateChange();
      }
    } catch (fetchError) {
      if (!disposed) {
        error =
          fetchError instanceof Error
            ? fetchError
            : new Error(String(fetchError));
        isLoading = false;
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
 * Handle an entity loaded event.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @param loadedEntity - The entity that was loaded.
 * @returns A new state with the entity set and loading false.
 */
export function handleEntityLoaded<T>(
  _currentState: UseEntityResult<T>,
  loadedEntity: Entity<T>,
): UseEntityResult<T> {
  return {
    entity: loadedEntity,
    isLoading: false,
    error: null,
  };
}

/**
 * Handle an entity not found.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @returns A new state with entity null, loading false, no error.
 */
export function handleEntityNotFound<T>(
  _currentState: UseEntityResult<T>,
): UseEntityResult<T> {
  return {
    entity: null,
    isLoading: false,
    error: null,
  };
}

/**
 * Handle an entity fetch error.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 * @param currentState - The current state snapshot.
 * @param fetchError - The error that occurred.
 * @returns A new state with the error set and loading false.
 */
export function handleEntityError<T>(
  currentState: UseEntityResult<T>,
  fetchError: Error,
): UseEntityResult<T> {
  return {
    entity: currentState.entity,
    isLoading: false,
    error: fetchError,
  };
}
