/**
 * Fundamental type definitions for the storage layer.
 * These types are used by StorageAdapter and are independent
 * of any specific storage backend.
 */

/**
 * An entity in a collection. Every entity has system metadata
 * alongside its domain-specific data.
 *
 * @typeParam T - The shape of the domain-specific data payload.
 */
export interface Entity<T> {
  /** Unique identifier (UUIDv7, time-sortable) */
  readonly id: string;

  /** Domain-specific data */
  readonly data: T;

  /** Per-entity version counter, incremented on every write */
  readonly revision: number;

  /** ISO 8601 timestamp of creation */
  readonly createdAt: string;

  /** ISO 8601 timestamp of last modification */
  readonly updatedAt: string;

  /** Soft-delete flag */
  readonly isDeleted: boolean;
}

/**
 * Represents a position in the server's change log.
 * The cursor value is opaque to the client — it should
 * not be parsed or compared, only stored and passed back.
 */
export interface Cursor {
  /** Opaque string representing the sync position */
  readonly value: string;

  /** ISO 8601 timestamp of when this cursor was established */
  readonly updatedAt: string;
}
