/**
 * SQLite implementation of the Transaction interface.
 *
 * Wraps a better-sqlite3 database connection. Provides the same
 * CRUD operations as StorageAdapter, scoped to the transaction.
 *
 * The transaction lifecycle (BEGIN/COMMIT/ROLLBACK) is managed
 * by SQLiteStorageAdapter.transaction(). This class only provides
 * the data operations.
 *
 * The commit() and rollback() methods are no-ops when called
 * within the adapter's transaction callback, because the adapter
 * handles commit/rollback automatically based on whether the
 * callback resolves or rejects. They exist for the Transaction
 * interface contract and for advanced manual usage.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Entity, Query } from '@offlinesync/storage';
import { NotFoundError } from '@offlinesync/storage';
import { mapError } from './errors.js';
import { translateQuery } from './query-translator.js';

/**
 * SQLite-backed transaction implementation.
 */
export class SQLiteTransaction {
  constructor(
    private readonly db: DatabaseType,
  ) {}

  /**
   * Retrieve an entity by ID within this transaction.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  async get<T>(collection: string, id: string): Promise<Entity<T>> {
    try {
      const row = this.db
        .prepare(
          'SELECT id, data, revision, created_at, updated_at, is_deleted FROM entities WHERE collection_name = ? AND id = ?',
        )
        .get(collection, id) as Row | undefined;

      if (row === undefined) {
        throw new NotFoundError(collection, id);
      }

      return rowToEntity<T>(row);
    } catch (error) {
      throw mapError(error, `tx.get(${collection}, ${id})`);
    }
  }

  /**
   * Create or update an entity within this transaction.
   */
  async put<T>(collection: string, entity: Entity<T>): Promise<void> {
    try {
      const dataJson = JSON.stringify(entity.data);
      this.db
        .prepare(
          `INSERT INTO entities (collection_name, id, data, revision, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(collection_name, id) DO UPDATE SET
             data = excluded.data,
             revision = excluded.revision,
             updated_at = excluded.updated_at,
             is_deleted = excluded.is_deleted`,
        )
        .run(
          collection,
          entity.id,
          dataJson,
          entity.revision,
          entity.createdAt,
          entity.updatedAt,
          entity.isDeleted ? 1 : 0,
        );
    } catch (error) {
      throw mapError(error, `tx.put(${collection}, ${entity.id})`);
    }
  }

  /**
   * Delete an entity by ID within this transaction.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  async delete(collection: string, id: string): Promise<void> {
    try {
      const result = this.db
        .prepare(
          'DELETE FROM entities WHERE collection_name = ? AND id = ?',
        )
        .run(collection, id);

      if (result.changes === 0) {
        throw new NotFoundError(collection, id);
      }
    } catch (error) {
      throw mapError(error, `tx.delete(${collection}, ${id})`);
    }
  }

  /**
   * Query entities within this transaction.
   */
  async query<T>(
    collection: string,
    query: Query<T>,
  ): Promise<Entity<T>[]> {
    try {
      const def = query.toDefinition();
      const { whereClause, params, orderByClause, limitClause, offsetClause } =
        translateQuery(def);

      const sql = `SELECT id, data, revision, created_at, updated_at, is_deleted
                    FROM entities
                    WHERE collection_name = ? AND ${whereClause.replace(/^WHERE /, '')}
                    ${orderByClause} ${limitClause} ${offsetClause}`;

      const allParams: unknown[] = [collection, ...params];
      if (def.limit !== null) allParams.push(def.limit);
      if (def.offset !== null) allParams.push(def.offset);

      const rows = this.db.prepare(sql).all(...allParams) as Row[];
      return rows.map((row) => rowToEntity<T>(row));
    } catch (error) {
      throw mapError(error, `tx.query(${collection})`);
    }
  }

  /**
   * Commit the transaction.
   *
   * Note: When using SQLiteStorageAdapter.transaction(),
   * the commit is handled automatically. Calling this method
   * directly within the callback is a no-op warning.
   */
  async commit(): Promise<void> {
    // The adapter manages the transaction lifecycle.
    // This method exists for the Transaction interface contract.
  }

  /**
   * Rollback the transaction.
   *
   * Note: When using SQLiteStorageAdapter.transaction(),
   * rollback is handled automatically when the callback throws.
   * This method is provided for the Transaction interface contract.
   */
  async rollback(): Promise<void> {
    // The adapter manages the transaction lifecycle.
    // This method exists for the Transaction interface contract.
  }
}

/**
 * Shape of a row returned from the entities table.
 */
interface Row {
  id: string;
  data: string;
  revision: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

/**
 * Convert a database row to an Entity<T>.
 */
function rowToEntity<T>(row: Row): Entity<T> {
  return {
    id: row.id,
    data: JSON.parse(row.data) as T,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}
