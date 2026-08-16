/**
 * Incremental sync request and response types.
 *
 * Incremental sync is the primary sync operation: the client sends
 * its cursor and pending mutations, and the server returns changes
 * and acknowledgments.
 */

import type { ProtocolMutation } from './mutation.js';

/**
 * Request sent by the client for incremental synchronization.
 */
export interface SyncRequest {
  /**
   * The client's current cursor position.
   * Opaque string — the client must not parse or compare it.
   * An empty string or absent cursor means "no prior sync" (initial sync).
   */
  cursor: string;

  /** Mutations the client is sending to the server */
  mutations: ProtocolMutation[];

  /** Client identifier — uniquely identifies this client instance */
  clientId: string;
}

/**
 * A single entity as it appears in protocol messages.
 * This is a structural (untyped) representation — the `data` field
 * is `unknown` because the protocol is language-independent.
 */
export interface ProtocolEntity {
  /** Unique identifier (UUIDv7, time-sortable) */
  id: string;

  /** Domain-specific data */
  data: unknown;

  /** Per-entity version counter */
  revision: number;

  /** ISO 8601 timestamp of creation */
  createdAt: string;

  /** ISO 8601 timestamp of last modification */
  updatedAt: string;

  /** Soft-delete flag */
  isDeleted: boolean;
}

/**
 * A single change from the server's change log.
 *
 * Changes are ordered by `serverSequence` in ascending order.
 * The client MUST apply them in this order (INV-1).
 */
export interface Change {
  /**
   * Server-side sequence number for this change.
   * This is a global log position, NOT an entity revision (INV-6).
   */
  serverSequence: number;

  /** The collection this entity belongs to */
  collectionName: string;

  /** The entity as it exists after this change was applied */
  entity: ProtocolEntity;

  /** The operation that produced this change */
  operation: string;

  /** The field modified (null for set/patch operations) */
  field: string | null;

  /** The value of the operation */
  value: unknown;
}

/**
 * Information about a conflict detected by the server.
 *
 * A conflict occurs when a mutation's `baseRevision` does not match
 * the server's current entity revision, meaning another client
 * modified the entity after this client's last sync.
 */
export interface ConflictInfo {
  /** The mutation ID that caused the conflict */
  mutationId: string;

  /** The entity ID in conflict */
  entityId: string;

  /** The collection name */
  collectionName: string;

  /** The client's entity revision (stale) */
  clientRevision: number;

  /** The server's entity revision (current) */
  serverRevision: number;

  /** The server's current entity state */
  serverEntity: ProtocolEntity;
}

/**
 * Response from the server for an incremental sync request.
 */
export interface SyncResponse {
  /**
   * Changes from the server that the client should apply.
   * Ordered by `serverSequence` ascending — apply in order (INV-1).
   */
  changes: Change[];

  /**
   * Mutation IDs that the server has successfully applied.
   * The client should transition these mutations to ACKNOWLEDGED.
   */
  acknowledgedMutationIds: string[];

  /**
   * Conflicts detected by the server.
   * The client should NOT apply these mutations locally and
   * should invoke the conflict resolution strategy.
   */
  conflicts: ConflictInfo[];

  /**
   * New cursor position after this sync.
   * The client should advance its cursor to this value ONLY AFTER
   * all changes have been durably applied locally (INV-3).
   */
  newCursor: string;
}
