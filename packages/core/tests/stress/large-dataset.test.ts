/**
 * Stress test: Large dataset — create 10,000 entities, verify CRUD operations.
 *
 * This test validates that the Collection and InMemoryStorageAdapter can handle
 * large volumes of entities without correctness issues.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { createQuery } from '@offlinesync/storage';
import type { Entity } from '@offlinesync/storage';

const ENTITY_COUNT = 10_000;
const COLLECTION_NAME = 'stress-items';

interface ItemData {
  readonly name: string;
  readonly value: number;
  readonly tags: readonly string[];
}

describe('stress: large dataset', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should create and retrieve 10,000 entities when performing bulk inserts', async () => {
    const start = performance.now();

    for (let index = 0; index < ENTITY_COUNT; index++) {
      const entity: Entity<ItemData> = {
        id: `item-${index}`,
        data: {
          name: `Item ${index}`,
          value: index,
          tags: [`tag-${index % 10}`],
        },
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const insertDuration = performance.now() - start;

    // Verify retrieval
    const retrieved = await adapter.get<ItemData>(COLLECTION_NAME, 'item-9999');
    expect(retrieved.id).toBe('item-9999');
    expect(retrieved.data.value).toBe(9999);

    // Verify first entity
    const first = await adapter.get<ItemData>(COLLECTION_NAME, 'item-0');
    expect(first.data.name).toBe('Item 0');

    // Insert should complete within 30 seconds
    expect(insertDuration).toBeLessThan(30_000);
  });

  it('should update 10,000 entities and verify updated data', async () => {
    // Seed entities
    const now = new Date().toISOString();
    for (let index = 0; index < ENTITY_COUNT; index++) {
      const entity: Entity<ItemData> = {
        id: `item-${index}`,
        data: { name: `Item ${index}`, value: index, tags: [] },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const start = performance.now();

    // Update every entity
    for (let index = 0; index < ENTITY_COUNT; index++) {
      const existing = await adapter.get<ItemData>(COLLECTION_NAME, `item-${index}`);
      const updated: Entity<ItemData> = {
        ...existing,
        data: { ...existing.data, value: existing.data.value + 1000 },
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await adapter.put(COLLECTION_NAME, updated);
    }

    const updateDuration = performance.now() - start;

    // Verify update correctness
    const entity = await adapter.get<ItemData>(COLLECTION_NAME, 'item-5000');
    expect(entity.data.value).toBe(6000);

    // Update should complete within 30 seconds
    expect(updateDuration).toBeLessThan(30_000);
  });

  it('should delete 10,000 entities and verify they are removed', async () => {
    // Seed entities
    const now = new Date().toISOString();
    for (let index = 0; index < ENTITY_COUNT; index++) {
      const entity: Entity<ItemData> = {
        id: `item-${index}`,
        data: { name: `Item ${index}`, value: index, tags: [] },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const start = performance.now();

    // Delete all entities
    for (let index = 0; index < ENTITY_COUNT; index++) {
      await adapter.delete(COLLECTION_NAME, `item-${index}`);
    }

    const deleteDuration = performance.now() - start;

    // Verify deletion
    const query = createQuery<ItemData>();
    const remaining = await adapter.query<ItemData>(COLLECTION_NAME, query);
    expect(remaining).toHaveLength(0);

    // Delete should complete within 30 seconds
    expect(deleteDuration).toBeLessThan(30_000);
  });

  it('should query across 10,000 entities with filters', async () => {
    // Seed entities
    const now = new Date().toISOString();
    for (let index = 0; index < ENTITY_COUNT; index++) {
      const entity: Entity<ItemData> = {
        id: `item-${index}`,
        data: { name: `Item ${index}`, value: index, tags: [] },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      await adapter.put(COLLECTION_NAME, entity);
    }

    const start = performance.now();

    // Query with a filter
    const query = createQuery<ItemData>()
      .where('value', 'gte', 5000)
      .limit(100);
    const results = await adapter.query<ItemData>(COLLECTION_NAME, query);

    const queryDuration = performance.now() - start;

    expect(results.length).toBeLessThanOrEqual(100);
    expect(results.length).toBeGreaterThan(0);
    for (const entity of results) {
      expect(entity.data.value).toBeGreaterThanOrEqual(5000);
    }

    // Query should complete within 5 seconds
    expect(queryDuration).toBeLessThan(5_000);
  });
});
