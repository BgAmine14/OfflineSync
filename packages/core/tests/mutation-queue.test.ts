/**
 * Tests for MutationQueue.
 *
 * Verifies:
 * - Durable mutation storage via StorageAdapter (INV-4)
 * - Sequence-ordered retrieval (INV-1)
 * - Status transitions (PENDING → IN_FLIGHT → ACKNOWLEDGED)
 * - Retry tracking
 * - Conflict marking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MutationQueue } from '../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE } from '../src/types/index.js';
import type { Mutation } from '../src/types/index.js';

describe('MutationQueue', () => {
  let storage: InMemoryStorageAdapter;
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
    storage = new InMemoryStorageAdapter();
    queue = new MutationQueue({ storage });
  });

  afterEach(() => {
    void storage.close();
  });

  describe('enqueue and dequeuePending', () => {
    it('should store and retrieve a pending mutation', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(mutation.id);
    });

    it('should respect the limit when dequeuing', async () => {
      for (let i = 1; i <= 5; i++) {
        await queue.enqueue(createTestMutation({ sequence: i }));
      }

      const pending = await queue.dequeuePending(3);
      expect(pending).toHaveLength(3);
    });

    it('should return mutations in sequence order (INV-1)', async () => {
      // Enqueue out of order
      await queue.enqueue(createTestMutation({ sequence: 3, id: 'mut-3' }));
      await queue.enqueue(createTestMutation({ sequence: 1, id: 'mut-1' }));
      await queue.enqueue(createTestMutation({ sequence: 2, id: 'mut-2' }));

      const pending = await queue.dequeuePending(10);
      expect(pending[0].id).toBe('mut-1');
      expect(pending[1].id).toBe('mut-2');
      expect(pending[2].id).toBe('mut-3');
    });

    it('should only return PENDING mutations', async () => {
      await queue.enqueue(createTestMutation({ sequence: 1, id: 'mut-1' }));
      await queue.enqueue(createTestMutation({
        sequence: 2,
        id: 'mut-2',
        status: MUTATION_STATUS.ACKNOWLEDGED,
      }));
      await queue.enqueue(createTestMutation({ sequence: 3, id: 'mut-3' }));

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe('mut-1');
      expect(pending[1].id).toBe('mut-3');
    });
  });

  describe('INV-4: Durability', () => {
    it('should persist mutations via the storage adapter', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);

      // Create a new queue with the same storage — simulates restart
      const newQueue = new MutationQueue({ storage });
      const pending = await newQueue.dequeuePending(10);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(mutation.id);
    });

    it('should survive across multiple mutations', async () => {
      for (let i = 1; i <= 10; i++) {
        await queue.enqueue(createTestMutation({
          sequence: i,
          id: `mutation-${i}`,
        }));
      }

      const newQueue = new MutationQueue({ storage });
      const pending = await newQueue.dequeuePending(100);

      expect(pending).toHaveLength(10);
    });
  });

  describe('Status transitions', () => {
    it('should mark a mutation as IN_FLIGHT', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);
      await queue.markInFlight(mutation.id);

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(0);
    });

    it('should mark a mutation as ACKNOWLEDGED', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);
      await queue.acknowledge(mutation.id);

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(0);
    });

    it('should mark a mutation as FAILED with error message', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);
      await queue.markFailed(mutation.id, 'Network timeout');

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(0);

      const allMutations = await queue.getMutationsForEntity('tasks', 'entity-1');
      const failed = allMutations.find((m) => m.id === mutation.id);
      expect(failed?.status).toBe(MUTATION_STATUS.FAILED);
      expect(failed?.lastError).toBe('Network timeout');
    });

    it('should mark a mutation as CONFLICT', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);
      await queue.markConflict(mutation.id, 'Revision mismatch');

      const allMutations = await queue.getMutationsForEntity('tasks', 'entity-1');
      const conflict = allMutations.find((m) => m.id === mutation.id);
      expect(conflict?.status).toBe(MUTATION_STATUS.CONFLICT);
      expect(conflict?.lastError).toBe('Revision mismatch');
    });

    it('should retry a failed mutation with incremented retry count', async () => {
      const mutation = createTestMutation({ sequence: 1 });
      await queue.enqueue(mutation);
      await queue.markFailed(mutation.id, 'Temporary error');
      await queue.retry(mutation.id);

      const allMutations = await queue.getMutationsForEntity('tasks', 'entity-1');
      const retried = allMutations.find((m) => m.id === mutation.id);
      expect(retried?.status).toBe(MUTATION_STATUS.IN_FLIGHT);
      expect(retried?.retries).toBe(1);
      expect(retried?.lastError).toBeNull();
    });
  });

  describe('getMutationsForEntity', () => {
    it('should return only mutations for the specified entity', async () => {
      await queue.enqueue(createTestMutation({
        sequence: 1,
        entityId: 'entity-1',
        id: 'mut-1',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 2,
        entityId: 'entity-2',
        id: 'mut-2',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 3,
        entityId: 'entity-1',
        id: 'mut-3',
      }));

      const entity1Mutations = await queue.getMutationsForEntity('tasks', 'entity-1');
      expect(entity1Mutations).toHaveLength(2);
      expect(entity1Mutations[0].id).toBe('mut-1');
      expect(entity1Mutations[1].id).toBe('mut-3');
    });

    it('should return empty array for entity with no mutations', async () => {
      const mutations = await queue.getMutationsForEntity('tasks', 'non-existent');
      expect(mutations).toHaveLength(0);
    });
  });

  describe('getMaxSequence', () => {
    it('should return 0 when no mutations exist', async () => {
      const maxSeq = await queue.getMaxSequence('tasks');
      expect(maxSeq).toBe(0);
    });

    it('should return the maximum sequence for a collection', async () => {
      await queue.enqueue(createTestMutation({
        sequence: 3,
        collectionName: 'tasks',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 7,
        collectionName: 'tasks',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 2,
        collectionName: 'users',
      }));

      const taskMax = await queue.getMaxSequence('tasks');
      const userMax = await queue.getMaxSequence('users');

      expect(taskMax).toBe(7);
      expect(userMax).toBe(2);
    });
  });

  describe('countByStatus', () => {
    it('should count mutations by status', async () => {
      await queue.enqueue(createTestMutation({ sequence: 1, id: 'mut-1' }));
      await queue.enqueue(createTestMutation({
        sequence: 2,
        id: 'mut-2',
        status: MUTATION_STATUS.ACKNOWLEDGED,
      }));
      await queue.enqueue(createTestMutation({ sequence: 3, id: 'mut-3' }));

      const pendingCount = await queue.countByStatus(MUTATION_STATUS.PENDING);
      const ackCount = await queue.countByStatus(MUTATION_STATUS.ACKNOWLEDGED);

      expect(pendingCount).toBe(2);
      expect(ackCount).toBe(1);
    });
  });

  describe('pendingCount', () => {
    it('should count PENDING + IN_FLIGHT + FAILED mutations', async () => {
      await queue.enqueue(createTestMutation({
        sequence: 1,
        status: MUTATION_STATUS.PENDING,
        id: 'mut-1',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 2,
        status: MUTATION_STATUS.IN_FLIGHT,
        id: 'mut-2',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 3,
        status: MUTATION_STATUS.FAILED,
        id: 'mut-3',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 4,
        status: MUTATION_STATUS.ACKNOWLEDGED,
        id: 'mut-4',
      }));
      await queue.enqueue(createTestMutation({
        sequence: 5,
        status: MUTATION_STATUS.CONFLICT,
        id: 'mut-5',
      }));

      const count = await queue.pendingCount();
      expect(count).toBe(3);
    });
  });

  describe('enqueue with transaction', () => {
    it('should store mutation via the provided transaction writer', async () => {
      const mutation = createTestMutation({ sequence: 1 });

      await storage.transaction(async (tx) => {
        await queue.enqueue(mutation, tx);
      });

      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(1);
    });
  });
});
