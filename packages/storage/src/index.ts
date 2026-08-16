/**
 * @offlinesync/storage
 *
 * StorageAdapter interface and storage type definitions.
 * This package is pure TypeScript — zero runtime dependencies.
 * Concrete implementations live in separate adapter packages.
 */

// Types
export type { Entity, Cursor } from './types.js';

// Query
export {
  QUERY_OPERATOR,
} from './query.js';
export type {
  QueryOperator,
  SortDirection,
  QueryFilter,
  QuerySort,
  QueryDefinition,
  Query,
} from './query.js';

// Transaction
export type { Transaction } from './transaction.js';

// StorageAdapter
export type { StorageAdapter } from './storage-adapter.js';

// Query builder
export { QueryBuilder, createQuery } from './query-builder.js';

// Errors
export {
  StorageError,
  NotFoundError,
  TransactionError,
  QueryError,
  ConstraintError,
} from './errors.js';
