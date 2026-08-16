/**
 * Stress test: High mutation rate — queue 1,000 mutations, verify all are durable.
 *
 * This test validates that the MutationQueue can handle a large volume
 * of enqueued mutations and that all mutations survive retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MutationQueue } from '../../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE } from '../../src/types/index.js';
import type { Mutation } from '../../src/types/index.js';

const MUTATION_COUNT = 1_000;

describe('stress: high mutation rate', () => {
  let adapter: InMemoryStorageAdapter;
  let queue: MutationQueue;

  function createTestMutation(overrides?: Partial<Mutation>): Mutation {
    return {
      id: overrides?.id ?? `mutation-${Math.random().toString(36).slice(2, 9)}`,
      entityId: overrides?.entityId ?? 'entity-1',
      collectionName: overrides?.collectionName ?? 'tasks',
      operation: overrides?.operation ?? OPERATION_TYPE.SET,
      field: overrides?.field ?? null,
      value: overrides?.value ?? { name: 'Test' },
      sequence: overrides?.sequence ?? 1,
      status: overrides?.status ?? MUTATION_STATUS.PENDING,
      createdAt: overrides?.createdAt ?? '2026-01-01T00:00:00.000Z',
      retries: overrides?.retries ?? 0,
      lastError: overrides?.lastError ?? null,
    };
  }

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    queue = new MutationQueue({ storage: adapter });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should enqueue 1,000 mutations and retrieve all when dequeuing', async () => {
    const start = performance.now();

    for (let index = 0; index < MUTATION_COUNT; index++) {
      const mutation = createTestMutation({
        id: `mut-${index}`,
        sequence: index + 1,
        entityId: `entity-${index % 100}`,
        collectionName: `collection-${index % 10}`,
      });
      await queue.enqueue(mutation);
    }

    const enqueueDuration = performance.now() - start;

    // Verify all are retrievable
    const pending = await queue.dequeuePending(MUTATION_COUNT + 1);
    expect(pending).toHaveLength(MUTATION_COUNT);

    // Verify sequence ordering
    for (let index = 0; index < pending.length - 1; index++) {
      const current = pending[index];
      const next = pending[index + 1];
      if (current === undefined || next === undefined) continue;
      expect(current.sequence).toBeLessThanOrEqual(next.sequence);
    }

    // Enqueue should complete within 10 seconds
    expect(enqueueDuration).toBeLessThan(10_000);
  });

  it('should acknowledge 1,000 mutations and clear the queue', async () => {
    // Enqueue 1,000 mutations
    for (let index = 0; index < MUTATION_COUNT; index++) {
      const mutation = createTestMutation({
        id: `mut-${index}`,
        sequence: index + 1,
      });
      await queue.enqueue(mutation);
    }

    const start = performance.now();

    // Acknowledge all mutations
    for (let index = 0; index < MUTATION_COUNT; index++) {
      await queue.acknowledge(`mut-${index}`);
    }

    const acknowledgeDuration = performance.now() - start;

    // Verify queue is empty
    const pending = await queue.dequeuePending(MUTATION_COUNT + 1);
    expect(pending).toHaveLength(0);

    // Verify pending count
    const count = await queue.pendingCount();
    expect(count).toBe(0);

    // Acknowledge should complete within 30 seconds
    expect(acknowledgeDuration).toBeLessThan(30_000);
  });

  it('should handle 1,000 mutations across multiple collections', async () => {
    const collections = ['users', 'tasks', 'projects', 'tags', 'comments'];
    const mutationsPerCollection = MUTATION_COUNT / collections.length;

    const start = performance.now();

    for (const collectionName of collections) {
      for (let index = 0; index < mutationsPerCollection; index++) {
        const mutation = createTestMutation({
          id: `mut-${collectionName}-${index}`,
          sequence: index + 1,
          collectionName,
          entityId: `entity-${index}`,
        });
        await queue.enqueue(mutation);
      }
    }

    const enqueueDuration = performance.now() - start;

    // Verify count per collection
    for (const collectionName of collections) {
      const maxSequence = await queue.getMaxSequence(collectionName);
      expect(maxSequence).toBe(mutationsPerCollection);
    }

    // Total pending should be MUTATION_COUNT
    const totalPending = await queue.pendingCount();
    expect(totalPending).toBe(MUTATION_COUNT);

    // Enqueue should complete within 10 seconds
    expect(enqueueDuration).toBeLessThan(10_000);
  });
});
