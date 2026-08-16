/**
 * Protocol-level mutation representation.
 *
 * This type lives in the protocol domain — it is NOT the same as
 * the client-side Mutation in @offlinesync/core. Conversion between
 * the two happens at the boundary layer (SyncEngine).
 *
 * Key differences from client Mutation:
 * - No `sequence`, `status`, `retries`, or `lastError` (client-internal fields)
 * - Has `baseRevision` (the entity revision this mutation is based on)
 */

/**
 * A mutation as represented in the wire protocol.
 * Carries exactly the information the server needs to apply the mutation
 * and detect conflicts.
 */
export interface ProtocolMutation {
  /** Unique identifier for this mutation (UUIDv7) */
  id: string;

  /** The entity this mutation targets */
  entityId: string;

  /** The collection the entity belongs to */
  collectionName: string;

  /** The type of operation (set, patch, increment, decrement, add, remove) */
  operation: string;

  /**
   * The field being modified.
   * `null` for 'set' and 'patch' operations that affect the entire data object.
   */
  field: string | null;

  /** The value for the operation */
  value: unknown;

  /**
   * The entity revision this mutation is based on.
   * Used by the server for conflict detection (INV-2):
   * if the server's current revision differs from baseRevision,
   * a conflict is reported instead of applying the mutation.
   */
  baseRevision: number;

  /** ISO 8601 timestamp of when the mutation was created */
  createdAt: string;
}
