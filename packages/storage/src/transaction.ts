/**
 * Transaction interface for atomic storage operations.
 *
 * A Transaction is obtained from StorageAdapter.transaction().
 * It should not be constructed directly.
 *
 * Either all operations in the transaction are applied, or none are.
 * If the callback passed to StorageAdapter.transaction() throws,
 * the transaction is automatically rolled back.
 */

import type { Entity } from './types.js';
import type { Query } from './query.js';

/**
 * Represents an active storage transaction.
 * Provides the same CRUD operations as StorageAdapter,
 * plus commit and rollback.
 */
export interface Transaction {
  /**
   * Retrieve an entity by ID within this transaction.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  get<T>(collection: string, id: string): Promise<Entity<T>>;

  /**
   * Create or update an entity within this transaction.
   * If an entity with the same ID exists, it is replaced.
   */
  put<T>(collection: string, entity: Entity<T>): Promise<void>;

  /**
   * Delete an entity by ID within this transaction.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  delete(collection: string, id: string): Promise<void>;

  /**
   * Query entities within this transaction.
   */
  query<T>(collection: string, query: Query<T>): Promise<Entity<T>[]>;

  /**
   * Commit the transaction.
   * All changes made within the transaction are durably written.
   */
  commit(): Promise<void>;

  /**
   * Rollback the transaction.
   * All changes made within the transaction are discarded.
   */
  rollback(): Promise<void>;
}
