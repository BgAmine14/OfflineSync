/**
 * Benchmark: Mutation queue throughput — measure enqueue/dequeue rate.
 *
 * This test measures the throughput of MutationQueue operations
 * and asserts reasonable performance bounds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MutationQueue } from '../../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE } from '../../src/types/index.js';
import type { Mutation } from '../../src/types/index.js';

const MUTATION_COUNT = 5_000;

describe('benchmark: mutation queue throughput', () => {
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

  it('should enqueue 5,000 mutations in under 10 seconds', async () => {
    const start = performance.now();

    for (let index = 0; index < MUTATION_COUNT; index++) {
      const mutation = createTestMutation({
        id: `bench-mut-${index}`,
        sequence: index + 1,
        entityId: `entity-${index % 100}`,
      });
      await queue.enqueue(mutation);
    }

    const duration = performance.now() - start;

    // Assert performance bound
    expect(duration).toBeLessThan(10_000);
  });

  it('should dequeue 5,000 mutations in under 10 seconds', async () => {
    // Pre-seed mutations
    for (let index = 0; index < MUTATION_COUNT; index++) {
      const mutation = createTestMutation({
        id: `bench-mut-${index}`,
        sequence: index + 1,
      });
      await queue.enqueue(mutation);
    }

    const start = performance.now();

    const pending = await queue.dequeuePending(MUTATION_COUNT + 1);

    const duration = performance.now() - start;

    // Verify correctness
    expect(pending).toHaveLength(MUTATION_COUNT);

    // Assert performance bound
    expect(duration).toBeLessThan(10_000);
  });

  it('should complete enqueue-acknowledge cycle for 5,000 mutations in under 15 seconds', async () => {
    const ids: string[] = [];

    const start = performance.now();

    // Enqueue phase
    for (let index = 0; index < MUTATION_COUNT; index++) {
      const id = `bench-mut-${index}`;
      ids.push(id);
      const mutation = createTestMutation({
        id,
        sequence: index + 1,
      });
      await queue.enqueue(mutation);
    }

    // Acknowledge phase
    for (const id of ids) {
      await queue.acknowledge(id);
    }

    const totalDuration = performance.now() - start;

    // Verify queue is empty
    const pending = await queue.dequeuePending(MUTATION_COUNT + 1);
    expect(pending).toHaveLength(0);

    // Assert performance bound
    expect(totalDuration).toBeLessThan(15_000);
  });
});
