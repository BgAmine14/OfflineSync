/**
 * SQLite schema definitions for OfflineSync.
 *
 * Uses a single `entities` table with `collection_name` as a
 * partitioning column. Entity data is stored as JSON text.
 * Metadata fields are separate columns for queryability.
 */

/**
 * SQL statements to initialize the database schema.
 * Called once when the SQLiteStorageAdapter opens a database.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  collection_name TEXT NOT NULL,
  id            TEXT NOT NULL,
  data          TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_name, id)
);

CREATE INDEX IF NOT EXISTS idx_entities_collection
  ON entities (collection_name, is_deleted, updated_at);
`;

/**
 * PRAGMA settings applied when opening the database.
 * These are performance and safety optimizations.
 *
 * - WAL: Write-Ahead Logging for better concurrent read performance.
 * - synchronous=NORMAL: Safe with WAL; flushes to OS but not disk
 *   on every commit. The OS flushes to disk periodically.
 * - foreign_keys=ON: Enforce referential integrity if foreign keys
 *   are added in future schema migrations.
 * - busy_timeout=5000: Retry for up to 5 seconds if the database
 *   is locked by another connection (e.g., concurrent reads).
 */
export const PRAGMA_SQL = [
  'PRAGMA journal_mode = WAL;',
  'PRAGMA synchronous = NORMAL;',
  'PRAGMA foreign_keys = ON;',
  'PRAGMA busy_timeout = 5000;',
] as const;
