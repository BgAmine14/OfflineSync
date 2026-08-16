/**
 * Mutation types for the client-side sync engine.
 *
 * Every local write creates exactly one mutation.
 * These types live in @offlinesync/core.
 */

/**
 * Type of mutation operation.
 * Defined in @offlinesync/core, NOT in @offlinesync/conflict.
 *
 * Algebraic properties:
 * - increment/decrement: COMMUTATIVE (order doesn't matter)
 * - add/remove: COMMUTATIVE on sets (order doesn't matter)
 * - set: NOT commutative (last write wins)
 * - patch: NOT commutative (depends on existing state)
 */
export const OPERATION_TYPE = {
  /** Replace entire entity data */
  SET: 'set',
  /** Merge partial data into entity */
  PATCH: 'patch',
  /** Add a number to a numeric field */
  INCREMENT: 'increment',
  /** Subtract a number from a numeric field */
  DECREMENT: 'decrement',
  /** Add an item to an array field */
  ADD: 'add',
  /** Remove an item from an array field */
  REMOVE: 'remove',
} as const;

export type OperationType =
  (typeof OPERATION_TYPE)[keyof typeof OPERATION_TYPE];

/**
 * Status of a mutation. There is NO 'COMPLETED' status —
 * ACKNOWLEDGED is the terminal success state.
 */
export const MUTATION_STATUS = {
  /** Mutation created, waiting to be sent */
  PENDING: 'PENDING',
  /** Mutation is currently being sent to the server */
  IN_FLIGHT: 'IN_FLIGHT',
  /** Server confirmed receipt and application */
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  /** Server rejected or network error, may retry */
  FAILED: 'FAILED',
  /** Unresolvable conflict detected */
  CONFLICT: 'CONFLICT',
} as const;

export type MutationStatus =
  (typeof MUTATION_STATUS)[keyof typeof MUTATION_STATUS];

/**
 * A mutation records a single write operation on an entity.
 * Every local write creates exactly one mutation.
 */
export interface Mutation {
  /** Unique identifier for this mutation */
  readonly id: string;

  /** The entity this mutation targets */
  readonly entityId: string;

  /** The collection the entity belongs to */
  readonly collectionName: string;

  /** The type of operation */
  readonly operation: OperationType;

  /**
   * The field being modified.
   * null for 'set' and 'patch' operations.
   */
  readonly field: string | null;

  /** The value for the operation */
  readonly value: unknown;

  /** Monotonically increasing sequence number */
  readonly sequence: number;

  /** Current status of this mutation */
  readonly status: MutationStatus;

  /** ISO 8601 timestamp of creation */
  readonly createdAt: string;

  /** Number of send attempts */
  readonly retries: number;

  /** Last error message (null if no error) */
  readonly lastError: string | null;
}
