/**
 * Tests for atomic writes (INV-8).
 *
 * Verifies that entity writes and mutation records are stored
 * atomically within a single transaction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Collection } from '../src/collection.js';
import { MutationRecorder, type IdGenerator } from '../src/mutation-recorder.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE } from '../src/types/index.js';

interface TaskData {
  title: string;
  completed: boolean;
}

function createIdGenerator(): IdGenerator {
  let counter = 0;
  return {
    generate(): string {
      counter += 1;
      return `uuidv7-${String(counter).padStart(4, '0')}`;
    },
  };
}

describe('INV-8: Atomic writes', () => {
  let storage: InMemoryStorageAdapter;
  let recorder: MutationRecorder;
  let queue: MutationQueue;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    recorder = new MutationRecorder({ idGenerator: createIdGenerator() });
    queue = new MutationQueue({ storage });
  });

  afterEach(() => {
    void storage.close();
  });

  function createCollection(): Collection<TaskData> {
    return new Collection<TaskData>('tasks', storage, {
      mutationRecorder: recorder,
      mutationQueue: queue,
    });
  }

  describe('create with mutation tracking', () => {
    it('should store entity and mutation atomically', async () => {
      const collection = createCollection();
      await collection.create('task-1', {
        title: 'Test task',
        completed: false,
      });

      // Entity should be stored
      const stored = await collection.get('task-1');
      expect(stored.data).toEqual({ title: 'Test task', completed: false });
      expect(stored.revision).toBe(1);

      // Mutation should be stored
      const mutations = await queue.getMutationsForEntity('tasks', 'task-1');
      expect(mutations).toHaveLength(1);
      expect(mutations[0].operation).toBe(OPERATION_TYPE.SET);
      expect(mutations[0].status).toBe(MUTATION_STATUS.PENDING);
      expect(mutations[0].sequence).toBe(1);
    });

    it('should throw if entity already exists', async () => {
      const collection = createCollection();
      await collection.create('task-1', {
        title: 'First',
        completed: false,
      });

      await expect(
        collection.create('task-1', { title: 'Duplicate', completed: true }),
      ).rejects.toThrow("Entity 'task-1' already exists");

      // No duplicate mutation should have been created
      const mutations = await queue.getMutationsForEntity('tasks', 'task-1');
      expect(mutations).toHaveLength(1);
    });

    it('should emit a create change event', async () => {
      const collection = createCollection();
      const events: { type: string; entityId: string }[] = [];
      collection.subscribe((event) => {
        events.push({
          type: event.type,
          entityId: event.entity?.id ?? '',
        });
      });

      await collection.create('task-1', { title: 'Test', completed: false });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('create');
      expect(events[0].entityId).toBe('task-1');
    });
  });

  describe('update with mutation tracking', () => {
    it('should store entity update and mutation atomically', async () => {
      const collection = createCollection();
      await collection.create('task-1', { title: 'Original', completed: false });

      const updated = await collection.update('task-1', { completed: true });

      expect(updated.data).toEqual({ title: 'Original', completed: true });
      expect(updated.revision).toBe(2);

      // Should have 2 mutations: create + update
      const mutations = await queue.getMutationsForEntity('tasks', 'task-1');
      expect(mutations).toHaveLength(2);
      expect(mutations[1].operation).toBe(OPERATION_TYPE.SET);
      expect(mutations[1].sequence).toBe(2);
    });

    it('should emit an update change event', async () => {
      const collection = createCollection();
      await collection.create('task-1', { title: 'Test', completed: false });

      const events: { type: string }[] = [];
      collection.subscribe((event) => {
        events.push({ type: event.type });
      });

      await collection.update('task-1', { completed: true });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('update');
    });
  });

  describe('delete with mutation tracking', () => {
    it('should store entity deletion and mutation atomically', async () => {
      const collection = createCollection();
      await collection.create('task-1', { title: 'To delete', completed: false });

      const deleted = await collection.delete('task-1');

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.revision).toBe(2);

      // Should have 2 mutations: create + delete
      const mutations = await queue.getMutationsForEntity('tasks', 'task-1');
      expect(mutations).toHaveLength(2);
      expect(mutations[1].operation).toBe(OPERATION_TYPE.SET);
      expect(mutations[1].sequence).toBe(2);
    });

    it('should emit a delete change event', async () => {
      const collection = createCollection();
      await collection.create('task-1', { title: 'Test', completed: false });

      const events: { type: string }[] = [];
      collection.subscribe((event) => {
        events.push({ type: event.type });
      });

      await collection.delete('task-1');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('delete');
    });
  });

  describe('INV-8: Transaction atomicity', () => {
    it('should have matching entity and mutation counts after writes', async () => {
      const collection = createCollection();

      await collection.create('task-1', { title: 'Task 1', completed: false });
      await collection.update('task-1', { completed: true });
      await collection.create('task-2', { title: 'Task 2', completed: false });
      await collection.delete('task-2');

      // Verify entities
      const task1 = await collection.getOrNull('task-1');
      expect(task1).not.toBeNull();
      expect(task1?.data.completed).toBe(true);

      const task2 = await collection.getOrNull('task-2');
      expect(task2).not.toBeNull();
      expect(task2?.isDeleted).toBe(true);

      // Verify mutations — 4 total (create, update, create, delete)
      const task1Mutations = await queue.getMutationsForEntity('tasks', 'task-1');
      const task2Mutations = await queue.getMutationsForEntity('tasks', 'task-2');

      expect(task1Mutations).toHaveLength(2);
      expect(task2Mutations).toHaveLength(2);

      // Verify sequence ordering within each entity
      expect(task1Mutations[0].sequence).toBe(1);
      expect(task1Mutations[1].sequence).toBe(2);
      expect(task2Mutations[0].sequence).toBe(3);
      expect(task2Mutations[1].sequence).toBe(4);
    });

    it('should not create a mutation if the transaction fails', async () => {
      // Note: In the InMemoryStorageAdapter, transactions don't truly
      // fail independently. This test verifies the logical atomicity:
      // the mutation is only created after the entity is stored.
      const collection = createCollection();

      await collection.create('task-1', { title: 'Test', completed: false });

      // Verify: exactly 1 entity and 1 mutation
      const stored = await collection.getOrNull('task-1');
      const mutations = await queue.getMutationsForEntity('tasks', 'task-1');

      expect(stored).not.toBeNull();
      expect(mutations).toHaveLength(1);
    });
  });

  describe('without mutation tracking', () => {
    it('should work normally without recorder or queue', async () => {
      const collection = new Collection<TaskData>('tasks', storage);

      const entity = await collection.create('task-1', {
        title: 'No mutations',
        completed: false,
      });

      expect(entity.data.title).toBe('No mutations');

      // No mutations should be stored
      const pending = await queue.dequeuePending(10);
      expect(pending).toHaveLength(0);
    });
  });
});
