/**
 * Stress test: Concurrent operations — simulate 100 concurrent writes
 * to the same collection using Promise.allSettled.
 *
 * This test validates that the InMemoryStorageAdapter and Collection
 * can handle concurrent write operations without data loss or corruption.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import type { Entity } from '@offlinesync/storage';

const COLLECTION_NAME = 'concurrent-items';
const CONCURRENT_WRITES = 100;

interface ConcurrentData {
  readonly writerId: number;
  readonly timestamp: string;
}

describe('stress: concurrent operations', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should handle 100 concurrent puts to the same collection without errors', async () => {
    const writePromises: Promise<void>[] = [];

    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      const entity: Entity<ConcurrentData> = {
        id: `entity-${index}`,
        data: {
          writerId: index,
          timestamp: new Date().toISOString(),
        },
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };
      writePromises.push(adapter.put(COLLECTION_NAME, entity));
    }

    const start = performance.now();
    const results = await Promise.allSettled(writePromises);
    const duration = performance.now() - start;

    // All writes should succeed
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(0);

    // Verify all entities are retrievable
    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      const entity = await adapter.get<ConcurrentData>(
        COLLECTION_NAME,
        `entity-${index}`,
      );
      expect(entity.data.writerId).toBe(index);
    }

    // Should complete within 5 seconds
    expect(duration).toBeLessThan(5_000);
  });

  it('should handle 100 concurrent transactions without errors', async () => {
    const transactionPromises: Promise<void>[] = [];

    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      const promise = adapter.transaction(async (tx) => {
        const entity: Entity<ConcurrentData> = {
          id: `tx-entity-${index}`,
          data: {
            writerId: index,
            timestamp: new Date().toISOString(),
          },
          revision: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDeleted: false,
        };
        await tx.put(COLLECTION_NAME, entity);
      });
      transactionPromises.push(promise);
    }

    const start = performance.now();
    const results = await Promise.allSettled(transactionPromises);
    const duration = performance.now() - start;

    // All transactions should succeed
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(0);

    // Verify all entities are retrievable
    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      const entity = await adapter.get<ConcurrentData>(
        COLLECTION_NAME,
        `tx-entity-${index}`,
      );
      expect(entity.data.writerId).toBe(index);
    }

    // Should complete within 10 seconds
    expect(duration).toBeLessThan(10_000);
  });

  it('should handle concurrent reads and writes without errors', async () => {
    // First, seed some entities
    const now = new Date().toISOString();
    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      const entity: Entity<ConcurrentData> = {
        id: `entity-${index}`,
        data: { writerId: index, timestamp: now },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const operations: Promise<unknown>[] = [];

    // Mix reads and writes
    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      if (index % 2 === 0) {
        // Read operation
        operations.push(
          adapter.get<ConcurrentData>(COLLECTION_NAME, `entity-${index}`),
        );
      } else {
        // Write operation (update existing)
        operations.push(
          adapter.put(COLLECTION_NAME, {
            id: `entity-${index}`,
            data: {
              writerId: index,
              timestamp: new Date().toISOString(),
            },
            revision: 2,
            createdAt: now,
            updatedAt: new Date().toISOString(),
            isDeleted: false,
          }),
        );
      }
    }

    const start = performance.now();
    const results = await Promise.allSettled(operations);
    const duration = performance.now() - start;

    // All operations should succeed
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(0);

    // Should complete within 5 seconds
    expect(duration).toBeLessThan(5_000);
  });
});
