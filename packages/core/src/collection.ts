/**
 * Collection — the primary developer-facing API for data access.
 *
 * A Collection<T> wraps a StorageAdapter and provides typed CRUD
 * operations, querying, change observation, and sync state
 * tracking for a single named collection.
 *
 * When a MutationRecorder and MutationQueue are provided, every
 * write operation creates a durable mutation record within the
 * same atomic transaction as the entity write (INV-8).
 *
 * Collections are created by the OfflineSync engine (Phase 3).
 * They are NOT constructed directly by application code.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */

import type { Entity } from '@offlinesync/storage';
import type { StorageAdapter } from '@offlinesync/storage';
import type { Query } from '@offlinesync/storage';
import { createQuery } from '@offlinesync/storage';
import type { SyncState } from './types/index.js';
import { SYNC_STATE } from './types/index.js';
import type { Mutation } from './types/index.js';
import type { MutationRecorder } from './mutation-recorder.js';
import type { MutationQueue } from './mutation-queue.js';


// -------------------------------------------------------------------
// Change event types
// -------------------------------------------------------------------

/**
 * Describes the type of operation that caused a collection change.
 */
export const COLLECTION_CHANGE_TYPE = {
  /** A new entity was created */
  CREATE: 'create',
  /** An existing entity was updated */
  UPDATE: 'update',
  /** An entity was soft-deleted */
  DELETE: 'delete',
  /** An entity was hard-deleted (purged from storage) */
  PURGE: 'purge',
} as const;

export type CollectionChangeType =
  (typeof COLLECTION_CHANGE_TYPE)[keyof typeof COLLECTION_CHANGE_TYPE];

/**
 * Emitted whenever entities in a collection are modified.
 */
export interface CollectionChangeEvent<T> {
  /** The type of operation */
  readonly type: CollectionChangeType;
  /** The collection name */
  readonly collectionName: string;
  /** The affected entity (null for purge if entity no longer exists) */
  readonly entity: Entity<T> | null;
}

/**
 * Observer callback for collection change events.
 */
export type CollectionChangeCallback<T> = (
  event: CollectionChangeEvent<T>,
) => void;

/**
 * Subscription handle returned by Collection.subscribe().
 * Call dispose() to stop receiving events.
 */
export interface CollectionSubscription {
  /** Stop receiving change events for this subscription. */
  dispose(): void;
}

// -------------------------------------------------------------------
// Internal event emitter (minimal, no external dependency)
// -------------------------------------------------------------------

interface Listener<T> {
  callback: CollectionChangeCallback<T>;
  once: boolean;
}

class ChangeEmitter<T> {
  private listeners: Listener<T>[] = [];

  add(callback: CollectionChangeCallback<T>, once: boolean): void {
    this.listeners.push({ callback, once });
  }

  remove(callback: CollectionChangeCallback<T>): void {
    this.listeners = this.listeners.filter(
      (listener) => listener.callback !== callback,
    );
  }

  emit(event: CollectionChangeEvent<T>): void {
    const keep: Listener<T>[] = [];
    for (const listener of this.listeners) {
      try {
        listener.callback(event);
      } catch {
        // Observer errors must not break the emitter.
        // They are logged but do not propagate.
      }
      if (listener.once) {
        // Don't keep one-time listeners after emission.
      } else {
        keep.push(listener);
      }
    }
    this.listeners = keep;
  }

  hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  removeAllListeners(): void {
    this.listeners = [];
  }
}

// -------------------------------------------------------------------
// Collection<T>
// -------------------------------------------------------------------

/**
 * Options for creating a Collection.
 */
export interface CollectionOptions {
  /**
 * Optional MutationRecorder. When provided, every write
 * creates a mutation record within the same transaction (INV-8).
 */
  readonly mutationRecorder?: MutationRecorder;
  /**
 * Optional MutationQueue. When provided alongside mutationRecorder,
 * mutations are durably stored in the same transaction (INV-8, INV-4).
 */
  readonly mutationQueue?: MutationQueue;
}

/**
 * A typed collection of entities backed by a StorageAdapter.
 *
 * Provides CRUD operations, querying, change observation,
 * and sync state tracking for a single named collection.
 *
 * When a MutationRecorder and MutationQueue are provided, every write
 * operation (create, put, update, delete) atomically stores both the
 * entity update and the mutation record in a single transaction (INV-8).
 *
 * @example
 * ```typescript
 * const users = sync.collection<User>('users');
 * await users.put({ id: 'abc', data: { name: 'Alice' }, ... });
 * const entity = await users.get('abc');
 * ```
 */
export class Collection<T> {
  private readonly storage: StorageAdapter;
  private readonly emitter: ChangeEmitter<T>;
  private currentSyncState: SyncState;
  private readonly mutationRecorder?: MutationRecorder;
  private readonly mutationQueue?: MutationQueue;

  /**
   * Whether this collection records mutations on writes.
   * True when both recorder and queue are provided.
   */
  private readonly hasMutationTracking: boolean;

  /**
   * Create a new Collection.
   *
   * @param name - The unique name of this collection.
   * @param storage - The storage adapter to use.
   * @param options - Optional configuration for mutation tracking.
   */
  constructor(
    private readonly name: string,
    storage: StorageAdapter,
    options?: CollectionOptions,
  ) {
    this.storage = storage;
    this.emitter = new ChangeEmitter<T>();
    this.currentSyncState = SYNC_STATE.LOCAL_ONLY;
    this.mutationRecorder = options?.mutationRecorder;
    this.mutationQueue = options?.mutationQueue;
    this.hasMutationTracking =
      this.mutationRecorder !== undefined &&
      this.mutationQueue !== undefined;
  }

  // ----------------------------------------------------------------
  // Read operations
  // ----------------------------------------------------------------

  /**
   * Retrieve an entity by ID.
   *
   * @param id - The entity's unique identifier.
   * @returns The full entity with metadata.
   * @throws {NotFoundError} if the entity does not exist.
   */
  async get(id: string): Promise<Entity<T>> {
    return this.storage.get<T>(this.name, id);
  }

  /**
   * Retrieve an entity by ID, or return null if not found.
   *
   * This is a convenience method that catches NotFoundError.
   *
   * @param id - The entity's unique identifier.
   * @returns The entity, or null if not found.
   */
  async getOrNull(id: string): Promise<Entity<T> | null> {
    try {
      return await this.storage.get<T>(this.name, id);
    } catch (error) {
      // Use duck-typing on the `code` property rather than instanceof
      // to avoid ESM module deduplication issues across package boundaries.
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'NOT_FOUND'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query entities in this collection.
   *
   * @param query - A Query<T> built via createQuery<T>().
   * @returns Array of matching entities.
   */
  async query(query: Query<T>): Promise<Entity<T>[]> {
    return this.storage.query<T>(this.name, query);
  }

  // ----------------------------------------------------------------
  // Write operations
  // ----------------------------------------------------------------

  /**
   * Create a new entity.
   *
   * The entity must not already exist in the collection.
   * To create-or-replace, use {@link put}.
   *
   * When mutation tracking is enabled, the entity creation and
   * the mutation record are stored atomically (INV-8).
   *
   * @param id - The entity's unique identifier.
   * @param data - The domain-specific data payload.
   * @returns The created entity with full metadata.
   * @throws {Error} if an entity with the same ID already exists.
   */
  async create(id: string, data: T): Promise<Entity<T>> {
    const now = new Date().toISOString();
    const entity: Entity<T> = {
      id,
      data,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    };

    if (this.hasMutationTracking) {
      return this.atomicWrite(entity, 'create');
    }

    // Without mutation tracking, check existence then write.
    const existing = await this.getOrNull(id);
    if (existing !== null) {
      throw new Error(
        `Entity '${id}' already exists in collection '${this.name}'. Use put() to update.`,
      );
    }

    await this.storage.put<T>(this.name, entity);
    this.emitChange('create', entity);
    return entity;
  }

  /**
   * Create or update an entity.
   *
   * If an entity with the same ID exists, it is replaced entirely.
   * If no entity exists, a new one is created.
   *
   * When mutation tracking is enabled, the entity write and
   * the mutation record are stored atomically (INV-8).
   *
   * @param entity - The full entity to store.
   */
  async put(entity: Entity<T>): Promise<void> {
    if (this.hasMutationTracking) {
      // Determine change type before the atomic write
      const existing = await this.getOrNull(entity.id);
      const changeType = existing === null ? 'create' : 'update';
      await this.atomicPut(entity);
      this.emitChange(changeType, entity);
      return;
    }

    // Without mutation tracking
    const existing = await this.getOrNull(entity.id);
    const isCreate = existing === null;

    await this.storage.put<T>(this.name, entity);

    const changeType = isCreate ? 'create' : 'update';
    this.emitChange(changeType, entity);
  }

  /**
   * Update an existing entity's data.
   *
   * Merges the partial data into the existing entity's data field,
   * increments the revision, and updates the timestamp.
   *
   * When mutation tracking is enabled, the entity update and
   * the mutation record are stored atomically (INV-8).
   *
   * @param id - The entity's unique identifier.
   * @param partialData - Partial data to merge into the existing data.
   * @returns The updated entity with full metadata.
   * @throws {NotFoundError} if the entity does not exist.
   */
  async update(id: string, partialData: Partial<T>): Promise<Entity<T>> {
    const existing = await this.storage.get<T>(this.name, id);

    const updatedEntity: Entity<T> = {
      ...existing,
      data: { ...existing.data, ...partialData } as T,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    if (this.hasMutationTracking) {
      return this.atomicWrite(updatedEntity, 'update');
    }

    await this.storage.put<T>(this.name, updatedEntity);
    this.emitChange('update', updatedEntity);
    return updatedEntity;
  }

  /**
   * Soft-delete an entity.
   *
   * Sets the entity's isDeleted flag to true. The entity remains
   * in storage until it is synced to the server and the retention
   * period expires (hard delete).
   *
   * When mutation tracking is enabled, the entity deletion and
   * the mutation record are stored atomically (INV-8).
   *
   * @param id - The entity's unique identifier.
   * @returns The soft-deleted entity.
   * @throws {NotFoundError} if the entity does not exist.
   */
  async delete(id: string): Promise<Entity<T>> {
    const existing = await this.storage.get<T>(this.name, id);

    const deletedEntity: Entity<T> = {
      ...existing,
      isDeleted: true,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    if (this.hasMutationTracking) {
      return this.atomicWrite(deletedEntity, 'delete');
    }

    await this.storage.put<T>(this.name, deletedEntity);
    this.emitChange('delete', deletedEntity);
    return deletedEntity;
  }

  // ----------------------------------------------------------------
  // Query builder (convenience)
  // ----------------------------------------------------------------

  /**
   * Create a new typed query for this collection.
   *
   * @returns A new Query<T> that can be chained with where/orderBy/limit/offset.
   */
  createQuery(): Query<T> {
    return createQuery<T>();
  }

  // ----------------------------------------------------------------
  // Change observation
  // ----------------------------------------------------------------

  /**
   * Subscribe to change events on this collection.
   *
   * The callback is invoked synchronously whenever an entity
   * in this collection is created, updated, deleted, or purged
   * through this Collection instance.
   *
   * @param callback - Function called on each change event.
   * @returns A subscription handle. Call dispose() to unsubscribe.
   */
  subscribe(callback: CollectionChangeCallback<T>): CollectionSubscription {
    this.emitter.add(callback, false);
    return {
      dispose: () => {
        this.emitter.remove(callback);
      },
    };
  }

  // ----------------------------------------------------------------
  // Sync state
  // ----------------------------------------------------------------

  /**
   * Get the current sync state for this collection.
   *
   * The sync state reflects the SYNC RELATIONSHIP with the server,
   * not network status. See {@link SYNC_STATE} for descriptions.
   */
  get syncState(): SyncState {
    return this.currentSyncState;
  }

  /**
   * Update the sync state for this collection.
   *
   * This is called internally by the SyncEngine (Phase 6+).
   * Application code should NOT call this directly.
   *
   * @param state - The new sync state.
   */
  setSyncState(state: SyncState): void {
    const previous = this.currentSyncState;
    this.currentSyncState = state;
    if (previous !== state) {
      this.emitter.emit({
        type: 'update',
        collectionName: this.name,
        entity: null,
      });
    }
  }

  // ----------------------------------------------------------------
  // Atomic writes (INV-8)
  // ----------------------------------------------------------------

  /**
   * Perform an atomic write: entity + mutation in a single transaction.
   *
   * This ensures that either both the entity update and the mutation
   * record are persisted, or neither is (INV-8).
   *
   * @param entity - The entity to store.
   * @param changeType - The type of change for the event.
   * @returns The stored entity.
   */
  private async atomicWrite(
    entity: Entity<T>,
    changeType: CollectionChangeType,
  ): Promise<Entity<T>> {
    const recorder = this.mutationRecorder;
    const queue = this.mutationQueue;
    if (recorder === undefined || queue === undefined) {
      throw new Error('Mutation tracking not configured');
    }

    // Create the mutation record BEFORE entering the transaction,
    // since record creation is synchronous and doesn't touch storage.
    const mutation = this.recordMutation(recorder, entity, changeType);

    // Execute entity write + mutation storage in a single transaction (INV-8)
    await this.storage.transaction(async (tx) => {
      // For create, check that the entity doesn't already exist
      if (changeType === 'create') {
        try {
          await tx.get<T>(this.name, entity.id);
          throw new Error(
            `Entity '${entity.id}' already exists in collection '${this.name}'. Use put() to update.`,
          );
        } catch (error) {
          if (
            error !== null &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code: string }).code === 'NOT_FOUND'
          ) {
            // Expected: entity doesn't exist yet
          } else {
            throw error;
          }
        }
      }

      // Write the entity
      await tx.put<T>(this.name, entity);

      // Store the mutation in the same transaction
      await queue.enqueue(mutation, tx);
    });

    this.emitChange(changeType, entity);
    return entity;
  }

  /**
   * Atomic put variant that doesn't return the entity.
   */
  private async atomicPut(entity: Entity<T>): Promise<void> {
    const recorder = this.mutationRecorder;
    const queue = this.mutationQueue;
    if (recorder === undefined || queue === undefined) {
      throw new Error('Mutation tracking not configured');
    }

    const mutation = recorder.recordSet<T>(this.name, entity);

    await this.storage.transaction(async (tx) => {
      await tx.put<T>(this.name, entity);
      await queue.enqueue(mutation, tx);
    });
  }

  /**
   * Create the appropriate mutation for a write operation.
   */
  private recordMutation(
    recorder: MutationRecorder,
    entity: Entity<T>,
    changeType: CollectionChangeType,
  ): Mutation {
    if (changeType === 'delete') {
      return recorder.recordDelete<T>(this.name, entity);
    }
    if (changeType === 'update') {
      return recorder.recordSet<T>(this.name, entity);
    }
    // Create
    return recorder.recordSet<T>(this.name, entity);
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  /**
   * Emit a change event to all subscribers.
   */
  private emitChange(
    type: CollectionChangeType,
    entity: Entity<T> | null,
  ): void {
    if (!this.emitter.hasListeners()) {
      return;
    }
    this.emitter.emit({
      type,
      collectionName: this.name,
      entity,
    });
  }
}
