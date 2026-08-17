/**
 * Property-based tests for invariants.
 *
 * Uses fast-check to verify invariant properties hold
 * for randomly generated inputs.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RecoveryManager } from '../../src/recovery-manager.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import type { Entity } from '@offlinesync/storage';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

interface TestMutationRecord {
  readonly entityId: string;
  readonly collectionName: string;
  readonly operation: string;
  readonly field: string | null;
  readonly value: unknown;
  readonly sequence: number;
  readonly status: string;
  readonly createdAt: string;
  readonly retries: number;
  readonly lastError: string | null;
}

function createMutationEntity(
  id: string,
  overrides: Partial<TestMutationRecord> = {},
): Entity<TestMutationRecord> {
  return {
    id,
    data: {
      entityId: 'entity-1',
      collectionName: 'tasks',
      operation: 'set',
      field: null,
      value: { title: 'Test' },
      sequence: 1,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      retries: 0,
      lastError: null,
      ...overrides,
    },
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };
}

describe('Property-Based Invariant Tests', () => {
  // ----------------------------------------------------------------
  // INV-4: Recovery never loses mutations
  // ----------------------------------------------------------------
  describe('INV-4: recovery never loses mutations', () => {
    it('should preserve all PENDING mutations through recovery', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.string({ minLength: 5, maxLength: 20 }),
              sequence: fc.nat(),
            }),
            { minLength: 1, maxLength: 50 },
          ),
          async (mutations) => {
            const freshStorage = new InMemoryStorageAdapter();

            for (const mutation of mutations) {
              await freshStorage.put(
                'tasks',
                {
                  id: `entity-${mutation.id}`,
                  data: { title: 'Test' },
                  revision: 1,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  isDeleted: false,
                },
              );
              await freshStorage.put(
                '__mutations__',
                createMutationEntity(mutation.id, {
                  sequence: mutation.sequence,
                  status: 'PENDING',
                  entityId: `entity-${mutation.id}`,
                }),
              );
            }

            const recovery = new RecoveryManager({
              storage: freshStorage,
              applicationCollections: ['tasks'],
            });
            await recovery.recover();

            // Deduplicate by ID (last write wins, matching storage behavior)
            const uniqueMutations = new Map<string, (typeof mutations)[number]>();
            for (const m of mutations) {
              uniqueMutations.set(m.id, m);
            }

            for (const mutation of uniqueMutations.values()) {
              const stored = await freshStorage.get<TestMutationRecord>(
                '__mutations__',
                mutation.id,
              );
              expect(stored.data.status).toBe('PENDING');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ----------------------------------------------------------------
  // INV-4: Recovery resets all IN_FLIGHT to PENDING
  // ----------------------------------------------------------------
  describe('INV-4: recovery resets IN_FLIGHT to PENDING', () => {
    it('should reset any IN_FLIGHT mutations back to PENDING', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.string({ minLength: 5, maxLength: 20 }),
              sequence: fc.nat(),
              isInFlight: fc.boolean(),
            }),
            { minLength: 1, maxLength: 30 },
          ),
          async (mutationSpecs) => {
            const freshStorage = new InMemoryStorageAdapter();

            for (const spec of mutationSpecs) {
              const status = spec.isInFlight ? 'IN_FLIGHT' : 'PENDING';
              await freshStorage.put(
                '__mutations__',
                createMutationEntity(spec.id, {
                  sequence: spec.sequence,
                  status,
                  entityId: `entity-${spec.id}`,
                }),
              );
            }

            const recovery = new RecoveryManager({
              storage: freshStorage,
              applicationCollections: ['tasks'],
            });
            const result = await recovery.recover();

            for (const spec of mutationSpecs) {
              const stored = await freshStorage.get<TestMutationRecord>(
                '__mutations__',
                spec.id,
              );
              expect(stored.data.status).toBe('PENDING');
            }

            // Only count repairs for mutations whose final stored state was IN_FLIGHT
            // (duplicate IDs overwrite each other, so only the last write matters)
            const finalInFlightIds = new Set<string>();
            for (const spec of mutationSpecs) {
              if (spec.isInFlight) {
                finalInFlightIds.add(spec.id);
              } else {
                finalInFlightIds.delete(spec.id);
              }
            }
            expect(result.repairs).toHaveLength(finalInFlightIds.size);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ----------------------------------------------------------------
  // INV-1: Contiguous sequences pass recovery
  // ----------------------------------------------------------------
  describe('INV-1: contiguous sequences pass recovery', () => {
    it('should report no sequence warnings for contiguous sequences', () => {
      fc.assert(
        fc.asyncProperty(
          fc.nat({ max: 100 }),
          async (count) => {
            const freshStorage = new InMemoryStorageAdapter();

            for (let index = 1; index <= count + 1; index++) {
              await freshStorage.put(
                '__mutations__',
                createMutationEntity(`mut-seq-${index}`, {
                  sequence: index,
                  status: 'ACKNOWLEDGED',
                  entityId: `entity-${index}`,
                }),
              );
            }

            const recovery = new RecoveryManager({
              storage: freshStorage,
              applicationCollections: ['tasks'],
            });
            const result = await recovery.recover();

            const sequenceWarnings = result.warnings.filter(
              (warning) => warning.invariant === 'INV-1',
            );
            expect(sequenceWarnings).toHaveLength(0);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
