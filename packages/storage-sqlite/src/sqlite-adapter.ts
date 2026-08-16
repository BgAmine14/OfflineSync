/**
 * SQLite implementation of the StorageAdapter interface.
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * better-sqlite3 is synchronous by design — its API uses
 * synchronous calls which we wrap in Promises to match the
 * StorageAdapter interface.
 *
 * Thread safety: better-sqlite3 serializes all operations
 * through a single database connection, so concurrent calls
 * to the adapter are safe.
 */

import Database from 'better-sqlite3';
import type { Entity, Query, StorageAdapter, Transaction } from '@offlinesync/storage';
import { NotFoundError, TransactionError } from '@offlinesync/storage';
import { PRAGMA_SQL, SCHEMA_SQL } from './schema.js';
import { mapError } from './errors.js';
import { translateQuery } from './query-translator.js';
import { SQLiteTransaction } from './sqlite-transaction.js';

/**
 * Configuration options for the SQLite storage adapter.
 */
export interface SQLiteAdapterOptions {
  /** Path to the SQLite database file, or ':memory:' for in-memory. */
  readonly path?: string;
}

/**
 * SQLite-backed implementation of StorageAdapter.
 *
 * Opens a single better-sqlite3 database connection on construction.
 * All operations are serialized through this connection.
 *
 * @example
 * ```typescript
 * const adapter = new SQLiteStorageAdapter({ path: './data.db' });
 * await adapter.put('users', entity);
 * const found = await adapter.get('users', 'id-123');
 * await adapter.close();
 * ```
 */
export class SQLiteStorageAdapter implements StorageAdapter {
  private db: Database.Database;
  private closed = false;
  private inTransaction = false;

  constructor(options: SQLiteAdapterOptions = {}) {
    const path = options.path ?? ':memory:';
    this.db = new Database(path);
    this.initialize();
  }

  /**
   * Apply PRAGMA settings and create the schema.
   */
  private initialize(): void {
    for (const pragma of PRAGMA_SQL) {
      this.db.exec(pragma);
    }
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Assert that the adapter has not been closed.
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new TransactionError(
        'Storage adapter is closed',
        'adapter_closed',
      );
    }
  }

  /**
   * Retrieve an entity by ID from a collection.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  async get<T>(collection: string, id: string): Promise<Entity<T>> {
    this.assertOpen();
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
      throw mapError(error, `get(${collection}, ${id})`);
    }
  }

  /**
   * Create or update an entity in a collection.
   * If an entity with the same ID exists, it is replaced.
   */
  async put<T>(collection: string, entity: Entity<T>): Promise<void> {
    this.assertOpen();
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
      throw mapError(error, `put(${collection}, ${entity.id})`);
    }
  }

  /**
   * Delete an entity by ID from a collection.
   *
   * @throws {NotFoundError} if the entity does not exist.
   */
  async delete(collection: string, id: string): Promise<void> {
    this.assertOpen();
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
      throw mapError(error, `delete(${collection}, ${id})`);
    }
  }

  /**
   * Query entities in a collection.
   * Returns an array of matching entities.
   *
   * Soft-deleted entities (isDeleted = true) are excluded
   * from results by default.
   */
  async query<T>(
    collection: string,
    query: Query<T>,
  ): Promise<Entity<T>[]> {
    this.assertOpen();
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
      throw mapError(error, `query(${collection})`);
    }
  }

  /**
   * Execute a function within a transaction.
   *
   * Uses manual BEGIN/COMMIT/ROLLBACK to properly support
   * the async callback interface. better-sqlite3's built-in
   * transaction() is synchronous, so we manage the transaction
   * lifecycle ourselves.
   *
   * Nested transactions are not supported. Attempting to call
   * transaction() within a transaction callback throws
   * TransactionError.
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();

    if (this.inTransaction) {
      throw new TransactionError(
        'Nested transactions are not supported',
        'nested_transaction',
      );
    }

    this.inTransaction = true;
    this.db.exec('BEGIN IMMEDIATE');

    try {
      const tx = new SQLiteTransaction(this.db);
      const result = await callback(tx);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // If rollback fails, the transaction state is uncertain.
        // Wrap the original error with additional context.
      }
      // Re-throw with proper error mapping
      throw mapError(error, 'transaction()');
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * Close the storage adapter and release resources.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.db.close();
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
