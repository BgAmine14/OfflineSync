/**
 * Conflict resolution types for @offlinesync/conflict.
 *
 * This package operates at the boundary between protocol types
 * (ConflictInfo, ProtocolEntity) and application-level resolution logic.
 * It does NOT depend on @offlinesync/core — strategies are pure functions.
 */

import type { ConflictInfo, ProtocolEntity } from '@offlinesync/protocol';

// -------------------------------------------------------------------
// Resolution outcome
// -------------------------------------------------------------------

/**
 * The type of resolution a strategy chose.
 */
export const RESOLUTION_OUTCOME = {
  /** Keep the server's version of the entity. */
  SERVER_WINS: 'SERVER_WINS',
  /** Re-apply the client's mutation on top of the server entity. */
  CLIENT_WINS: 'CLIENT_WINS',
  /** Merge fields from both sides (strategy-specific logic). */
  MERGED: 'MERGED',
  /** The strategy could not resolve this conflict automatically. */
  MANUAL: 'MANUAL',
} as const;

export type ResolutionOutcome =
  (typeof RESOLUTION_OUTCOME)[keyof typeof RESOLUTION_OUTCOME];

/**
 * The result of a conflict resolution attempt.
 *
 * If `resolved` is true, `resolvedData` contains the merged/resolved
 * entity data that should be stored locally and re-sent to the server.
 * If `resolved` is false, the conflict requires manual intervention.
 */
export interface ConflictResolution {
  /** Whether the conflict was automatically resolved. */
  readonly resolved: boolean;
  /** The type of resolution that was applied. */
  readonly outcome: ResolutionOutcome;
  /**
   * The resolved entity data to store locally.
   * Only meaningful when `resolved` is true.
   */
  readonly resolvedData: unknown;
}

// -------------------------------------------------------------------
// Context passed to resolvers
// -------------------------------------------------------------------

/**
 * Full context for a conflict that a resolver receives.
 *
 * This bundles everything a strategy needs to make a decision:
 * the conflict info from the server, the local mutation that caused
 * it, the local entity state, and the server entity state.
 */
export interface ConflictContext {
  /** Conflict info from the server (protocol type). */
  readonly conflict: ConflictInfo;

  /**
   * The local mutation that caused the conflict.
   * `operation` is one of: 'set', 'patch', 'increment', 'decrement',
   * 'add', 'remove'.
   * `field` is null for set/patch, the field name for others.
   * `value` is the operation's value.
   * `createdAt` is the ISO 8601 timestamp.
   */
  readonly localMutation: {
    readonly id: string;
    readonly operation: string;
    readonly field: string | null;
    readonly value: unknown;
    readonly createdAt: string;
  };

  /**
   * The entity as it exists in the client's local storage.
   * This reflects the state AFTER the local mutation was applied.
   * May be undefined if the entity was deleted locally.
   */
  readonly localEntity: ProtocolEntity | undefined;

  /**
   * The entity as it exists on the server.
   * This is `conflict.serverEntity` repeated for convenience.
   */
  readonly serverEntity: ProtocolEntity;

  /** The collection name. */
  readonly collectionName: string;
}

// -------------------------------------------------------------------
// Resolver interface
// -------------------------------------------------------------------

/**
 * A conflict resolution strategy.
 *
 * Strategies are pure functions — they receive context and return
 * a resolution. They MUST NOT have side effects or perform I/O.
 *
 * The resolved data (when resolved is true) will be:
 * 1. Stored locally as the new entity data
 * 2. Wrapped in a new mutation with the resolved baseRevision
 *    and re-enqueued for sync
 */
export interface ConflictResolver {
  /**
   * Attempt to resolve a conflict.
   *
   * @param context - The full conflict context.
   * @returns A ConflictResolution describing the outcome.
   */
  resolve(context: ConflictContext): ConflictResolution;
}
