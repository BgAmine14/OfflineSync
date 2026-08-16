/**
 * Benchmark: Storage read/write throughput — measure put/get/query performance.
 *
 * This test measures the throughput of basic StorageAdapter operations
 * and asserts reasonable performance bounds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { createQuery } from '@offlinesync/storage';
import type { Entity } from '@offlinesync/storage';

const PUT_COUNT = 10_000;
const GET_COUNT = 10_000;
const COLLECTION_NAME = 'benchmark-items';

interface BenchmarkData {
  readonly name: string;
  readonly value: number;
}

describe('benchmark: storage read/write throughput', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should perform 10,000 puts in under 5 seconds', async () => {
    const start = performance.now();

    for (let index = 0; index < PUT_COUNT; index++) {
      const entity: Entity<BenchmarkData> = {
        id: `bench-${index}`,
        data: { name: `Benchmark ${index}`, value: index },
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const duration = performance.now() - start;

    // Assert performance bound
    expect(duration).toBeLessThan(5_000);
  });

  it('should perform 10,000 gets in under 5 seconds', async () => {
    // Seed data
    const now = new Date().toISOString();
    for (let index = 0; index < GET_COUNT; index++) {
      const entity: Entity<BenchmarkData> = {
        id: `bench-${index}`,
        data: { name: `Benchmark ${index}`, value: index },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const start = performance.now();

    for (let index = 0; index < GET_COUNT; index++) {
      await adapter.get<BenchmarkData>(COLLECTION_NAME, `bench-${index}`);
    }

    const duration = performance.now() - start;

    // Assert performance bound
    expect(duration).toBeLessThan(5_000);
  });

  it('should perform query across 10,000 entities in under 5 seconds', async () => {
    // Seed data
    const now = new Date().toISOString();
    for (let index = 0; index < PUT_COUNT; index++) {
      const entity: Entity<BenchmarkData> = {
        id: `bench-${index}`,
        data: { name: `Benchmark ${index}`, value: index },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const start = performance.now();

    const query = createQuery<BenchmarkData>()
      .where('value', 'gte', 5000)
      .limit(1000);
    await adapter.query<BenchmarkData>(COLLECTION_NAME, query);

    const duration = performance.now() - start;

    // Assert performance bound
    expect(duration).toBeLessThan(5_000);
  });
});
