/**
 * Shared type definitions for @offlinesync/vue.
 */

import type { Entity, SyncState, Collection, SyncEngine, CollectionSubscription } from '@offlinesync/core';

/**
 * Result returned by the useCollection composable.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface UseCollectionResult<T> {
  /** All entities currently in the collection. */
  readonly entities: readonly Entity<T>[];
  /** Whether the initial data fetch is in progress. */
  readonly isLoading: boolean;
  /** Error from the most recent failed fetch, if any. */
  readonly error: Error | null;
  /** Current sync state of the collection. */
  readonly syncState: SyncState;
}

/**
 * Result returned by the useEntity composable.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface UseEntityResult<T> {
  /** The requested entity, or null if not found or loading. */
  readonly entity: Entity<T> | null;
  /** Whether the entity is being fetched. */
  readonly isLoading: boolean;
  /** Error from the most recent failed fetch, if any. */
  readonly error: Error | null;
}

/**
 * Options for the useCollection composable.
 */
export interface CollectionComposableOptions {
  /** Whether the composable is enabled. Defaults to true. */
  readonly enabled?: boolean;
}

/**
 * Value provided by the OfflineSync injection key.
 */
export interface OfflineSyncInjectionValue {
  /** The sync engine instance. */
  readonly engine: SyncEngine;
  /** Resolves a collection by name. */
  readonly getCollection: <T>(
    collectionName: string,
  ) => Collection<T> | undefined;
}

// -------------------------------------------------------------------
// Data source interfaces for logic layer
// -------------------------------------------------------------------

/**
 * Data source interface for collection operations.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface CollectionDataSource<T> {
  /** Fetch all entities in the collection. */
  getAll(): Promise<readonly Entity<T>[]>;
  /** Subscribe to change events. Returns a disposable subscription. */
  subscribeToChanges(callback: () => void): CollectionSubscription;
  /** Get the current sync state of the collection. */
  getSyncState(): SyncState;
}

/**
 * Data source interface for single entity operations.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface EntityDataSource<T> {
  /** Fetch a single entity by ID. Returns null if not found. */
  get(entityId: string): Promise<Entity<T> | null>;
  /** Subscribe to change events. Returns a disposable subscription. */
  subscribeToChanges(callback: () => void): CollectionSubscription;
}

/**
 * Data source for reading sync state.
 */
export interface SyncStateSource {
  /** Get the current sync state. */
  getSyncState(): SyncState;
  /** Subscribe to sync state changes. Returns cleanup function. */
  onStateChange(callback: (state: SyncState) => void): () => void;
}
