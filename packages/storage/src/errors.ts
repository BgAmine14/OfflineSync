/**
 * Typed error hierarchy for all storage operations.
 *
 * All storage operations throw typed errors from this hierarchy.
 * Implementations MUST NOT throw generic `Error` or `TypeError`.
 * All errors must be wrapped in the appropriate StorageError subclass.
 */

/**
 * Base error class for all storage operations.
 */
export class StorageError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/**
 * Thrown when an entity is not found.
 */
export class NotFoundError extends StorageError {
  public readonly collection: string;
  public readonly id: string;

  constructor(collection: string, id: string) {
    super(
      `Entity '${id}' not found in collection '${collection}'`,
      'NOT_FOUND',
    );
    this.name = 'NotFoundError';
    this.collection = collection;
    this.id = id;
  }
}

/**
 * Thrown when a transaction operation fails.
 */
export class TransactionError extends StorageError {
  public readonly reason: string | undefined;

  constructor(message: string, reason?: string) {
    super(message, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
    this.reason = reason;
  }
}

/**
 * Thrown when a query operation fails.
 */
export class QueryError extends StorageError {
  public readonly queryDetails: string | undefined;

  constructor(message: string, queryDetails?: string) {
    super(message, 'QUERY_ERROR');
    this.name = 'QueryError';
    this.queryDetails = queryDetails;
  }
}

/**
 * Thrown when a constraint violation occurs
 * (e.g., duplicate key, unique constraint).
 */
export class ConstraintError extends StorageError {
  public readonly constraint: string | undefined;

  constructor(message: string, constraint?: string) {
    super(message, 'CONSTRAINT_ERROR');
    this.name = 'ConstraintError';
    this.constraint = constraint;
  }
}
