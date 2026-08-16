/**
 * Built-in conflict resolution strategies.
 *
 * Each strategy is a pure function implementing ConflictResolver.
 * They are stateless and can be shared across collections.
 */

import type { ConflictContext, ConflictResolution, ConflictResolver } from './types.js';
import { RESOLUTION_OUTCOME } from './types.js';

// -------------------------------------------------------------------
// Server Wins
// -------------------------------------------------------------------

/**
 * Always accept the server's version. Discard the local mutation.
 *
 * Use case: data where the server is authoritative (e.g.
 * server-assigned metadata, audit logs).
 */
export class ServerWinsStrategy implements ConflictResolver {
  resolve(context: ConflictContext): ConflictResolution {
    return {
      resolved: true,
      outcome: RESOLUTION_OUTCOME.SERVER_WINS,
      resolvedData: context.serverEntity.data,
    };
  }
}

// -------------------------------------------------------------------
// Client Wins
// -------------------------------------------------------------------

/**
 * Always re-apply the client's mutation. Overwrite the server's version.
 *
 * Use case: user-owned data where the local client is authoritative
 * (e.g. user preferences, draft documents).
 *
 * For `set` operations: replaces server data with local data.
 * For `patch` operations: merges local patch on top of server data.
 * For field operations: applies the field-level operation on server data.
 */
export class ClientWinsStrategy implements ConflictResolver {
  resolve(context: ConflictContext): ConflictResolution {
    const { operation, field, value } = context.localMutation;
    const serverData = context.serverEntity.data;

    if (operation === 'set') {
      // Full replace — use local entity data if available
      return {
        resolved: true,
        outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
        resolvedData: context.localEntity?.data ?? value,
      };
    }

    if (operation === 'patch' && typeof value === 'object' && value !== null) {
      // Merge patch on top of server data
      return {
        resolved: true,
        outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
        resolvedData: mergeDeep(
          serverData,
          value as Record<string, unknown>,
        ),
      };
    }

    if (field !== null) {
      // Field-level operation on server data
      return {
        resolved: true,
        outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
        resolvedData: applyFieldOperation(
          serverData,
          field,
          operation,
          value,
        ),
      };
    }

    // Fallback: use local entity data
    return {
      resolved: true,
      outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
      resolvedData: context.localEntity?.data ?? serverData,
    };
  }
}

// -------------------------------------------------------------------
// Last Write Wins (LWW)
// -------------------------------------------------------------------

/**
 * Compare timestamps and pick the newer version.
 *
 * Uses the local mutation's `createdAt` vs the server entity's `updatedAt`.
 * If the local mutation is newer, the client wins; otherwise the server wins.
 *
 * This delegates to the appropriate strategy (client or server wins)
 * so the resolution logic is consistent.
 */
export class LastWriteWinsStrategy implements ConflictResolver {
  private readonly clientStrategy = new ClientWinsStrategy();
  private readonly serverStrategy = new ServerWinsStrategy();

  resolve(context: ConflictContext): ConflictResolution {
    const localTime = new Date(context.localMutation.createdAt).getTime();
    const serverTime = new Date(context.serverEntity.updatedAt).getTime();

    if (localTime > serverTime) {
      const result = this.clientStrategy.resolve(context);
      return { ...result, outcome: RESOLUTION_OUTCOME.CLIENT_WINS };
    }

    const result = this.serverStrategy.resolve(context);
    return { ...result, outcome: RESOLUTION_OUTCOME.SERVER_WINS };
  }
}

// -------------------------------------------------------------------
// Manual (no auto-resolution)
// -------------------------------------------------------------------

/**
 * Never auto-resolves. Always marks the conflict as requiring
 * manual intervention.
 *
 * Use case: critical data that requires human review (e.g.
 * financial transactions, legal documents).
 */
export class ManualStrategy implements ConflictResolver {
  resolve(_context: ConflictContext): ConflictResolution {
    return {
      resolved: false,
      outcome: RESOLUTION_OUTCOME.MANUAL,
      resolvedData: undefined,
    };
  }
}

// -------------------------------------------------------------------
// Field-level merge (for commutative operations)
// -------------------------------------------------------------------

/**
 * Attempts a field-level merge.
 *
 * - For `increment`/`decrement` (commutative): applies the client's
 *   numeric operation on top of the server value.
 * - For `add`/`remove` (set operations): applies the client's set
 *   operation on the server's array.
 * - For `set`/`patch` (non-commutative): falls back to server wins.
 *
 * This is the recommended strategy for counters, arrays, and
 * other commutative data types.
 */
export class FieldMergeStrategy implements ConflictResolver {
  /** Fallback strategy for non-commutative operations. */
  private readonly fallback: ConflictResolver;

  constructor(fallback?: ConflictResolver) {
    this.fallback = fallback ?? new ServerWinsStrategy();
  }

  resolve(context: ConflictContext): ConflictResolution {
    const { operation, field, value } = context.localMutation;

    if (field === null) {
      // No field = set/patch — non-commutative, use fallback
      return this.fallback.resolve(context);
    }

    if (operation === 'increment' || operation === 'decrement') {
      return this.resolveCommutativeNumeric(context, field, operation, value);
    }

    if (operation === 'add' || operation === 'remove') {
      return this.resolveCommutativeSet(context, field, operation, value);
    }

    // Unknown operation — fallback
    return this.fallback.resolve(context);
  }

  private resolveCommutativeNumeric(
    context: ConflictContext,
    field: string,
    operation: string,
    value: unknown,
  ): ConflictResolution {
    const serverData = context.serverEntity.data;
    const merged = applyFieldOperation(serverData, field, operation, value);

    return {
      resolved: true,
      outcome: RESOLUTION_OUTCOME.MERGED,
      resolvedData: merged,
    };
  }

  private resolveCommutativeSet(
    context: ConflictContext,
    field: string,
    operation: string,
    value: unknown,
  ): ConflictResolution {
    const serverData = context.serverEntity.data;
    const merged = applyFieldOperation(serverData, field, operation, value);

    return {
      resolved: true,
      outcome: RESOLUTION_OUTCOME.MERGED,
      resolvedData: merged,
    };
  }
}

// -------------------------------------------------------------------
// Operation-Aware Strategy
// -------------------------------------------------------------------

/**
 * Configuration for which strategy to use for each operation category.
 */
export interface OperationAwareConfig {
  /** Strategy for commutative operations (increment, decrement, add, remove). */
  readonly commutativeStrategy: ConflictResolver;
  /** Strategy for non-commutative operations (set, patch). */
  readonly nonCommutativeStrategy: ConflictResolver;
  /** Fallback strategy for unrecognized operations. */
  readonly fallbackStrategy?: ConflictResolver;
}

/**
 * Routes conflicts to different strategies based on the mutation's
 * operation type and commutativity.
 *
 * Commutative operations (increment, decrement, add, remove) can be
 * safely merged with the server's state because the order of
 * application doesn't affect the final value. For example, if both
 * sides increment a counter, applying both increments produces the
 * correct result regardless of order.
 *
 * Non-commutative operations (set, patch) depend on the current state,
 * so they require a different strategy (e.g., LWW or server wins).
 *
 * @example
 * ```typescript
 * const strategy = new OperationAwareStrategy({
 *   commutativeStrategy: new FieldMergeStrategy(),
 *   nonCommutativeStrategy: new LastWriteWinsStrategy(),
 * });
 * ```
 */
export class OperationAwareStrategy implements ConflictResolver {
  private readonly commutative: ConflictResolver;
  private readonly nonCommutative: ConflictResolver;
  private readonly fallback: ConflictResolver;

  constructor(config: OperationAwareConfig) {
    this.commutative = config.commutativeStrategy;
    this.nonCommutative = config.nonCommutativeStrategy;
    this.fallback = config.fallbackStrategy ?? config.nonCommutativeStrategy;
  }

  resolve(context: ConflictContext): ConflictResolution {
    const { operation, field } = context.localMutation;

    // Commutative field-level operations
    if (
      field !== null &&
      (operation === 'increment' ||
        operation === 'decrement' ||
        operation === 'add' ||
        operation === 'remove')
    ) {
      return this.commutative.resolve(context);
    }

    // Non-commutative operations (set, patch, or field ops we don't recognize)
    if (
      operation === 'set' ||
      operation === 'patch'
    ) {
      return this.nonCommutative.resolve(context);
    }

    // Unknown operation — fallback
    return this.fallback.resolve(context);
  }
}

// -------------------------------------------------------------------
// Function Strategy (convenience wrapper)
// -------------------------------------------------------------------

/**
 * A function that resolves a conflict.
 *
 * This is the function signature that {@link FunctionStrategy} accepts.
 * It receives a {@link ConflictContext} and returns a {@link ConflictResolution}.
 *
 * @example
 * ```typescript
 * const resolver: ConflictResolveFunction = (context) => {
 *   if (context.localMutation.createdAt > context.serverEntity.updatedAt) {
 *     return { resolved: true, outcome: 'CLIENT_WINS', resolvedData: context.localEntity?.data };
 *   }
 *   return { resolved: true, outcome: 'SERVER_WINS', resolvedData: context.serverEntity.data };
 * };
 * ```
 */
export type ConflictResolveFunction = (context: ConflictContext) => ConflictResolution;

/**
 * Wraps a plain function as a {@link ConflictResolver}.
 *
 * This is a convenience class for users who prefer defining strategies
 * as functions rather than implementing the full interface.
 *
 * @example
 * ```typescript
 * const myStrategy = new FunctionStrategy((context) => {
 *   return {
 *     resolved: true,
 *     outcome: 'SERVER_WINS',
 *     resolvedData: context.serverEntity.data,
 *   };
 * });
 *
 * // Use with ConflictResolutionManager
 * const manager = new ConflictResolutionManager({
 *   defaultStrategy: myStrategy,
 * });
 * ```
 */
export class FunctionStrategy implements ConflictResolver {
  private readonly resolveFunction: ConflictResolveFunction;

  /**
   * @param resolveFunction - A pure function that resolves conflicts.
   *   Must be deterministic (INV-2): same inputs must always produce
   *   the same output.
   */
  constructor(resolveFunction: ConflictResolveFunction) {
    this.resolveFunction = resolveFunction;
  }

  resolve(context: ConflictContext): ConflictResolution {
    return this.resolveFunction(context);
  }
}

// -------------------------------------------------------------------
// Pure helpers (no side effects)
// -------------------------------------------------------------------

/**
 * Apply a field-level operation to a data object.
 * Returns a NEW object (immutable).
 */
function applyFieldOperation(
  data: unknown,
  field: string,
  operation: string,
  value: unknown,
): Record<string, unknown> {
  const record = typeof data === 'object' && data !== null
    ? { ...(data as Record<string, unknown>) }
    : {};

  const current = record[field];

  switch (operation) {
    case 'increment':
      record[field] = (typeof current === 'number' ? current : 0) +
        (typeof value === 'number' ? value : 0);
      break;

    case 'decrement':
      record[field] = (typeof current === 'number' ? current : 0) -
        (typeof value === 'number' ? value : 0);
      break;

    case 'add': {
      const arr = Array.isArray(current) ? [...current] : [];
      if (!arr.includes(value)) {
        arr.push(value);
      }
      record[field] = arr;
      break;
    }

    case 'remove': {
      const existing = Array.isArray(current) ? [...current] : [];
      record[field] = existing.filter((item) => item !== value);
      break;
    }

    default:
      // Unknown field operation — leave unchanged
      break;
  }

  return record;
}

/**
 * Deep merge two objects. Source fields override base fields.
 * Arrays are replaced (not concatenated).
 */
function mergeDeep(
  base: unknown,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = typeof base === 'object' && base !== null
    ? { ...(base as Record<string, unknown>) }
    : {};

  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeDeep(result[key], value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
