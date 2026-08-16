/**
 * Property-based tests for INV-2: Deterministic Conflict Resolution.
 *
 * "Given the same local entity state, remote entity state, local mutation,
 * and conflict strategy, the resolved entity state MUST be identical every time."
 *
 * These tests use fast-check to generate random conflict scenarios
 * and verify that calling resolve() twice with the same inputs
 * always produces the same output.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  ManualStrategy,
  FieldMergeStrategy,
  RESOLUTION_OUTCOME,
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
} from '../../src/index.js';
import type { ConflictContext, ConflictResolver } from '../../src/index.js';

// -------------------------------------------------------------------
// Arbitrary generators
// -------------------------------------------------------------------

/** Generate a random valid ISO 8601 timestamp string. */
const arbTimestamp: fc.Arbitrary<string> = fc
  .integer({ min: 1577836800000, max: 1924988399000 })
  .map((ms) => new Date(ms).toISOString());

/**
 * Generate a random ProtocolEntity with flat primitive data.
 * Uses fc.tuple + map for full control over the shape.
 */
function arbProtocolEntity(): fc.Arbitrary<{
  readonly id: string;
  readonly data: unknown;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isDeleted: boolean;
}> {
  return fc.tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.integer(-1000, 1000),
      { minKeys: 0, maxKeys: 5 },
    ),
    fc.nat(100),
    arbTimestamp,
    arbTimestamp,
    fc.boolean(),
  ).map(([id, data, revision, createdAt, updatedAt, isDeleted]) => ({
    id,
    data,
    revision,
    createdAt,
    updatedAt,
    isDeleted,
  }));
}

/** Generate a valid operation type string. */
const arbOperation: fc.Arbitrary<string> = fc.constantFrom(
  'set', 'patch', 'increment', 'decrement', 'add', 'remove',
);

/** Generate a random local mutation shape. */
function arbLocalMutation(): fc.Arbitrary<{
  readonly id: string;
  readonly operation: string;
  readonly field: string | null;
  readonly value: unknown;
  readonly createdAt: string;
}> {
  return fc.tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    arbOperation,
    fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: null }),
    fc.integer(-1000, 1000),
    arbTimestamp,
  ).map(([id, operation, field, value, createdAt]) => ({
    id,
    operation,
    field,
    value,
    createdAt,
  }));
}

/** Generate a random ConflictInfo. */
function arbConflictInfo(): fc.Arbitrary<{
  readonly mutationId: string;
  readonly entityId: string;
  readonly collectionName: string;
  readonly clientRevision: number;
  readonly serverRevision: number;
  readonly serverEntity: {
    readonly id: string;
    readonly data: unknown;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly isDeleted: boolean;
  };
}> {
  return fc.tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.nat(100),
    fc.nat(100),
    arbProtocolEntity(),
  ).map(
    ([mutationId, entityId, collectionName, clientRevision, serverRevision, serverEntity]) => ({
      mutationId,
      entityId,
      collectionName,
      clientRevision,
      serverRevision,
      serverEntity,
    }),
  );
}

/** Generate a full ConflictContext for testing. */
function arbConflictContext(): fc.Arbitrary<ConflictContext> {
  return fc.tuple(
    arbConflictInfo(),
    arbLocalMutation(),
    fc.option(arbProtocolEntity(), { nil: undefined as unknown }),
    arbProtocolEntity(),
    fc.string({ minLength: 1, maxLength: 20 }),
  ).map(
    ([conflict, localMutation, localEntity, serverEntity, collectionName]) => ({
      conflict,
      localMutation,
      localEntity: localEntity as ConflictContext['localEntity'],
      serverEntity,
      collectionName,
    }),
  );
}

// -------------------------------------------------------------------
// Helper: run a strategy and verify determinism
// -------------------------------------------------------------------

function assertDeterministic(strategy: ConflictResolver): void {
  fc.assert(
    fc.property(
      arbConflictContext(),
      (context) => {
        const result1 = strategy.resolve(context);
        const result2 = strategy.resolve(context);

        // Same outcome
        expect(result1.outcome).toBe(result2.outcome);

        // Same resolved flag
        expect(result1.resolved).toBe(result2.resolved);

        // Same resolved data (deep equality)
        expect(result1.resolvedData).toEqual(result2.resolvedData);
      },
    ),
    { numRuns: 500 },
  );
}

// -------------------------------------------------------------------
// INV-2 determinism tests for each built-in strategy
// -------------------------------------------------------------------

describe('INV-2: Deterministic Conflict Resolution', () => {
  describe('ServerWinsStrategy', () => {
    it('should always produce the same resolution for the same inputs', () => {
      assertDeterministic(new ServerWinsStrategy());
    });
  });

  describe('ClientWinsStrategy', () => {
    it('should always produce the same resolution for the same inputs', () => {
      assertDeterministic(new ClientWinsStrategy());
    });
  });

  describe('LastWriteWinsStrategy', () => {
    it('should always produce the same resolution for the same inputs', () => {
      assertDeterministic(new LastWriteWinsStrategy());
    });
  });

  describe('ManualStrategy', () => {
    it('should always produce the same resolution for the same inputs', () => {
      assertDeterministic(new ManualStrategy());
    });
  });

  describe('FieldMergeStrategy', () => {
    it('should always produce the same resolution for the same inputs', () => {
      assertDeterministic(new FieldMergeStrategy());
    });

    it('should be deterministic with custom fallback', () => {
      assertDeterministic(
        new FieldMergeStrategy(new ClientWinsStrategy()),
      );
    });
  });

  describe('ConflictResolutionManager', () => {
    it('should be deterministic with default LWW strategy', () => {
      const manager = new ConflictResolutionManager();
      const arb = arbConflictContext();
      fc.assert(
        fc.property(
          arb,
          (context) => {
            const r1 = manager.resolve(context);
            const r2 = manager.resolve(context);
            expect(r1.outcome).toBe(r2.outcome);
            expect(r1.resolved).toBe(r2.resolved);
            expect(r1.resolvedData).toEqual(r2.resolvedData);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('should be deterministic with per-collection strategies', () => {
      const manager = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.LAST_WRITE_WINS,
        collectionStrategies: {
          transactions: BUILT_IN_STRATEGY.MANUAL,
          counters: BUILT_IN_STRATEGY.FIELD_MERGE,
        },
      });

      const arb = arbConflictContext();
      fc.assert(
        fc.property(
          arb,
          (context) => {
            const r1 = manager.resolve(context);
            const r2 = manager.resolve(context);
            expect(r1.outcome).toBe(r2.outcome);
            expect(r1.resolved).toBe(r2.resolved);
            expect(r1.resolvedData).toEqual(r2.resolvedData);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('should be deterministic with fallback chain', () => {
      const manager = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.MANUAL,
        fallbackChain: [
          BUILT_IN_STRATEGY.MANUAL,
          BUILT_IN_STRATEGY.SERVER_WINS,
        ],
      });

      const arb = arbConflictContext();
      fc.assert(
        fc.property(
          arb,
          (context) => {
            const r1 = manager.resolve(context);
            const r2 = manager.resolve(context);
            expect(r1.outcome).toBe(r2.outcome);
            expect(r1.resolved).toBe(r2.resolved);
            expect(r1.resolvedData).toEqual(r2.resolvedData);
          },
        ),
        { numRuns: 500 },
      );
    });
  });

  describe('Custom strategy (function-based)', () => {
    it('should be deterministic when custom logic is pure', () => {
      const customResolver: ConflictResolver = {
        resolve(context: ConflictContext) {
          const serverData = context.serverEntity.data;
          const localData = context.localEntity?.data;
          if (typeof serverData !== 'object' || serverData === null) {
            return {
              resolved: true,
              outcome: RESOLUTION_OUTCOME.SERVER_WINS,
              resolvedData: serverData,
            };
          }
          if (typeof localData !== 'object' || localData === null) {
            return {
              resolved: true,
              outcome: RESOLUTION_OUTCOME.SERVER_WINS,
              resolvedData: serverData,
            };
          }
          const merged = {
            ...(localData as Record<string, unknown>),
            ...(serverData as Record<string, unknown>),
          };
          return {
            resolved: true,
            outcome: RESOLUTION_OUTCOME.MERGED,
            resolvedData: merged,
          };
        },
      };

      assertDeterministic(customResolver);
    });
  });
});
