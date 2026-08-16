/**
 * StorageAdapter — the abstract interface for all storage backends.
 *
 * All storage access in OfflineSync goes through this interface.
 * The core engine never imports SQLite, IndexedDB, or any
 * backend directly.
 *
 * Every StorageAdapter implementation must support transactions.
 */

import type { Entity } from './types.js';
import type { Query } from './query.js';
import type { Transaction } from './transaction.js';

/**
 * Abstract interface for storage backends.
 *
 * @contract
 * - Thread safety: handle concurrent calls (SQLite serialization,
 *   in-memory adapters use locks).
 * - Entity shape: store and retrieve the full Entity<T> shape.
 *   Do not interpret the `data` field.
 * - Collection isolation: operations on one collection do not
 *   affect another.
 * - Transaction isolation: at minimum READ COMMITTED.
 */
export interface StorageAdapter {
  /**
   * Retrieve an entity by ID from a collection.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  get<T>(collection: string, id: string): Promise<Entity<T>>;

  /**
   * Create or update an entity in a collection.
   * If an entity with the same ID exists, it is replaced.
   */
  put<T>(collection: string, entity: Entity<T>): Promise<void>;

  /**
   * Delete an entity by ID from a collection.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  delete(collection: string, id: string): Promise<void>;

  /**
   * Query entities in a collection.
   * Returns an array of matching entities.
   */
  query<T>(collection: string, query: Query<T>): Promise<Entity<T>[]>;

  /**
   * Execute a function within a transaction.
   * All operations within the callback share the same transaction.
   * If the callback completes successfully, the transaction is committed.
   * If the callback throws, the transaction is rolled back.
   */
  transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;

  /**
   * Close the storage adapter and release resources.
   */
  close(): Promise<void>;
}
