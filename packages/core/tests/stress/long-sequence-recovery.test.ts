/**
 * Stress test: Long sequence recovery — create 500 mutations across 10
 * collections, then run recovery and verify all mutations are accounted for.
 *
 * This test validates that the RecoveryManager can correctly handle
 * a large volume of mutations spread across many collections,
 * including scenarios with IN_FLIGHT mutations that need resetting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MutationQueue } from '../../src/mutation-queue.js';
import { RecoveryManager } from '../../src/recovery-manager.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE } from '../../src/types/index.js';
import type { Mutation, MutationStatus } from '../../src/types/index.js';

const MUTATIONS_PER_COLLECTION = 50;
const COLLECTION_COUNT = 10;
const TOTAL_MUTATIONS = MUTATIONS_PER_COLLECTION * COLLECTION_COUNT;

describe('stress: long sequence recovery', () => {
  let adapter: InMemoryStorageAdapter;
  let queue: MutationQueue;

  const collectionNames: string[] = [];

  for (let index = 0; index < COLLECTION_COUNT; index++) {
    collectionNames.push(`stress-collection-${index}`);
  }

  function createTestMutation(
    collectionName: string,
    sequence: number,
    status: MutationStatus = MUTATION_STATUS.PENDING,
  ): Mutation {
    return {
      id: `mut-${collectionName}-${sequence}`,
      entityId: `entity-${sequence}`,
      collectionName,
      operation: OPERATION_TYPE.SET,
      field: null,
      value: { name: `Mutation ${sequence}` },
      sequence,
      status,
      createdAt: new Date().toISOString(),
      retries: 0,
      lastError: null,
    };
  }

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    queue = new MutationQueue({ storage: adapter });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should recover 500 mutations across 10 collections with no data loss', async () => {
    // Create mutations across all collections
    for (const collectionName of collectionNames) {
      for (let index = 1; index <= MUTATIONS_PER_COLLECTION; index++) {
        const mutation = createTestMutation(collectionName, index);
        await queue.enqueue(mutation);
      }
    }

    // Verify all are pending
    const pendingBefore = await queue.pendingCount();
    expect(pendingBefore).toBe(TOTAL_MUTATIONS);

    // Run recovery (should find nothing wrong — all PENDING)
    const recoveryManager = new RecoveryManager({
      storage: adapter,
      applicationCollections: collectionNames,
    });

    const start = performance.now();
    const result = await recoveryManager.recover();
    const duration = performance.now() - start;

    // No repairs should be needed
    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);

    // No sequence warnings
    const sequenceWarnings = result.warnings.filter(
      (warning) => warning.invariant === 'INV-1',
    );
    expect(sequenceWarnings).toHaveLength(0);

    // All mutations should still be present
    const pendingAfter = await queue.pendingCount();
    expect(pendingAfter).toBe(TOTAL_MUTATIONS);

    // Recovery should complete within 10 seconds
    expect(duration).toBeLessThan(10_000);
  });

  it('should reset IN_FLIGHT mutations back to PENDING during recovery', async () => {
    // Create mutations: half PENDING, half IN_FLIGHT
    for (const collectionName of collectionNames) {
      for (let index = 1; index <= MUTATIONS_PER_COLLECTION; index++) {
        const status: MutationStatus =
          index % 2 === 0 ? MUTATION_STATUS.IN_FLIGHT : MUTATION_STATUS.PENDING;
        const mutation = createTestMutation(collectionName, index, status);
        await queue.enqueue(mutation);
      }
    }

    // Run recovery
    const recoveryManager = new RecoveryManager({
      storage: adapter,
      applicationCollections: collectionNames,
    });

    const start = performance.now();
    const result = await recoveryManager.recover();
    const duration = performance.now() - start;

    // Should have repaired IN_FLIGHT mutations
    expect(result.repaired).toBe(true);
    expect(result.repairs.length).toBe(TOTAL_MUTATIONS / 2);

    // All mutations should now be PENDING
    const pendingAfter = await queue.pendingCount();
    expect(pendingAfter).toBe(TOTAL_MUTATIONS);

    // Verify sequence integrity — no gaps
    const sequenceWarnings = result.warnings.filter(
      (warning) => warning.invariant === 'INV-1',
    );
    expect(sequenceWarnings).toHaveLength(0);

    // Recovery should complete within 10 seconds
    expect(duration).toBeLessThan(10_000);
  });

  it('should detect sequence gaps across 10 collections', async () => {
    // Create mutations with deliberate gaps
    for (const collectionName of collectionNames) {
      // Create sequences 1-25, skip 26-30, create 31-50
      for (let index = 1; index <= 25; index++) {
        const mutation = createTestMutation(collectionName, index);
        await queue.enqueue(mutation);
      }
      for (let index = 31; index <= MUTATIONS_PER_COLLECTION; index++) {
        const mutation = createTestMutation(collectionName, index);
        await queue.enqueue(mutation);
      }
    }

    // Run recovery
    const recoveryManager = new RecoveryManager({
      storage: adapter,
      applicationCollections: collectionNames,
    });

    const start = performance.now();
    const result = await recoveryManager.recover();
    const duration = performance.now() - start;

    // Should detect gaps in every collection
    const sequenceWarnings = result.warnings.filter(
      (warning) => warning.invariant === 'INV-1',
    );
    expect(sequenceWarnings.length).toBe(COLLECTION_COUNT);

    // Verify gap description mentions the expected sequence
    for (const warning of sequenceWarnings) {
      expect(warning.severity).toBe('high');
      expect(warning.description).toContain('Sequence gap');
    }

    // Recovery should complete within 10 seconds
    expect(duration).toBeLessThan(10_000);
  });
});
