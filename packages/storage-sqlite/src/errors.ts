/**
 * Maps better-sqlite3 errors to the StorageError hierarchy.
 *
 * All storage operations must throw typed errors from @offlinesync/storage.
 * This module provides the mapping functions.
 */

import {
  StorageError,
  TransactionError,
  ConstraintError,
} from '@offlinesync/storage';

/**
 * Check if a better-sqlite3 error indicates a constraint violation.
 */
function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('unique constraint') ||
    msg.includes('constraint failed') ||
    msg.includes('duplicate')
  );
}

/**
 * Check if a better-sqlite3 error indicates a database is locked/busy.
 */
function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('database is locked') || msg.includes('busy');
}

/**
 * Map a better-sqlite3 error to the appropriate StorageError.
 *
 * @param error - The raw error from better-sqlite3
 * @param context - Additional context for the error message
 * @returns A typed StorageError subclass
 */
export function mapError(
  error: unknown,
  context: string,
): StorageError {
  // Already a StorageError — pass through
  if (error instanceof StorageError) return error;

  if (isConstraintError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    return new ConstraintError(`${context}: ${message}`, 'SQLITE_CONSTRAINT');
  }

  if (isBusyError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    return new TransactionError(
      `${context}: ${message}`,
      'database_locked',
    );
  }

  // Default: wrap in a generic StorageError
  const message = error instanceof Error ? error.message : String(error);
  return new StorageError(`${context}: ${message}`, 'SQLITE_ERROR');
}
