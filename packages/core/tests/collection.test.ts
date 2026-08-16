/**
 * Tests for Collection<T> — CRUD, querying, change observation, sync state.
 *
 * Uses InMemoryStorageAdapter (from @offlinesync/storage) as the
 * storage backend, per testing rules.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Collection, COLLECTION_CHANGE_TYPE } from '../src/collection.js';
import type { CollectionChangeEvent } from '../src/collection.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { createQuery } from '@offlinesync/storage';
import type { Entity } from '@offlinesync/storage';
import { SYNC_STATE } from '../src/types/index.js';

describe('Collection', () => {
  interface TaskData {
    readonly title: string;
    readonly done: boolean;
    readonly priority: number;
  }

  type Task = Entity<TaskData>;

  const COLLECTION_NAME = 'tasks';
  let adapter: InMemoryStorageAdapter;
  let collection: Collection<TaskData>;

  function makeEntity(
    overrides: Partial<Entity<TaskData>> & { readonly id: string },
  ): Task {
    const now = new Date().toISOString();
    return {
      id: overrides.id,
      data: {
        title: overrides.data?.title ?? 'Test task',
        done: overrides.data?.done ?? false,
        priority: overrides.data?.priority ?? 0,
      },
      revision: overrides.revision ?? 1,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      isDeleted: overrides.isDeleted ?? false,
    };
  }

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    collection = new Collection<TaskData>(COLLECTION_NAME, adapter);
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ----------------------------------------------------------------
  // get
  // ----------------------------------------------------------------
  describe('get', () => {
    it('should return the entity when ID exists', async () => {
      const entity = makeEntity({ id: 'task-1' });
      await adapter.put(COLLECTION_NAME, entity);

      const result = await collection.get('task-1');

      expect(result).toEqual(entity);
    });

    it('should throw NotFoundError when entity does not exist', async () => {
      await expect(collection.get('non-existent')).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });

  // ----------------------------------------------------------------
  // getOrNull
  // ----------------------------------------------------------------
  describe('getOrNull', () => {
    it('should return the entity when ID exists', async () => {
      const entity = makeEntity({ id: 'task-1' });
      await adapter.put(COLLECTION_NAME, entity);

      const result = await collection.getOrNull('task-1');

      expect(result).toEqual(entity);
    });

    it('should return null when entity does not exist', async () => {
      const result = await collection.getOrNull('non-existent');

      expect(result).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // create
  // ----------------------------------------------------------------
  describe('create', () => {
    it('should create a new entity and return it', async () => {
      const entity = await collection.create('task-1', {
        title: 'Buy groceries',
        done: false,
        priority: 1,
      });

      expect(entity.id).toBe('task-1');
      expect(entity.data.title).toBe('Buy groceries');
      expect(entity.revision).toBe(1);
      expect(entity.isDeleted).toBe(false);
    });

    it('should persist the entity to storage', async () => {
      await collection.create('task-1', {
        title: 'Buy groceries',
        done: false,
        priority: 1,
      });

      const stored = await adapter.get<TaskData>(COLLECTION_NAME, 'task-1');
      expect(stored.id).toBe('task-1');
      expect(stored.data.title).toBe('Buy groceries');
    });

    it('should throw when entity with same ID already exists', async () => {
      await collection.create('task-1', {
        title: 'First',
        done: false,
        priority: 1,
      });

      await expect(
        collection.create('task-1', {
          title: 'Second',
          done: false,
          priority: 2,
        }),
      ).rejects.toThrow("already exists");
    });

    it('should emit a create change event', async () => {
      const events: CollectionChangeEvent<TaskData>[] = [];
      collection.subscribe((event) => events.push(event));

      const entity = await collection.create('task-1', {
        title: 'Buy groceries',
        done: false,
        priority: 1,
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('create');
      expect(events[0]?.collectionName).toBe(COLLECTION_NAME);
      expect(events[0]?.entity).toEqual(entity);
    });
  });

  // ----------------------------------------------------------------
  // put
  // ----------------------------------------------------------------
  describe('put', () => {
    it('should store a new entity when no existing entity', async () => {
      const entity = makeEntity({ id: 'task-1' });
      await collection.put(entity);

      const stored = await collection.get('task-1');
      expect(stored).toEqual(entity);
    });

    it('should emit a create change for a new entity', async () => {
      const events: CollectionChangeEvent<TaskData>[] = [];
      collection.subscribe((event) => events.push(event));

      const entity = makeEntity({ id: 'task-1' });
      await collection.put(entity);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('create');
    });

    it('should replace an existing entity', async () => {
      const original = makeEntity({ id: 'task-1' });
      await collection.put(original);

      const updated = makeEntity({
        id: 'task-1',
        data: { title: 'Updated', done: true, priority: 5 },
        revision: 2,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await collection.put(updated);

      const stored = await collection.get('task-1');
      expect(stored.data.title).toBe('Updated');
      expect(stored.revision).toBe(2);
    });

    it('should emit an update change for an existing entity', async () => {
      const original = makeEntity({ id: 'task-1' });
      await collection.put(original);

      const events: CollectionChangeEvent<TaskData>[] = [];
      collection.subscribe((event) => events.push(event));

      const updated = makeEntity({
        id: 'task-1',
        data: { title: 'Updated', done: true, priority: 5 },
        revision: 2,
      });
      await collection.put(updated);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('update');
    });
  });

  // ----------------------------------------------------------------
  // update
  // ----------------------------------------------------------------
  describe('update', () => {
    it('should merge partial data into existing entity', async () => {
      await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      const updated = await collection.update('task-1', { done: true });

      expect(updated.data.title).toBe('Original');
      expect(updated.data.done).toBe(true);
      expect(updated.data.priority).toBe(1);
    });

    it('should increment the revision', async () => {
      await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      const updated = await collection.update('task-1', { title: 'New' });

      expect(updated.revision).toBe(2);
    });

    it('should update the updatedAt timestamp', async () => {
      const original = await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      const updated = await collection.update('task-1', { title: 'New' });

      expect(updated.updatedAt >= original.updatedAt).toBe(true);
    });

    it('should throw NotFoundError when entity does not exist', async () => {
      await expect(
        collection.update('non-existent', { title: 'New' }),
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });

    it('should emit an update change event', async () => {
      await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      const events: CollectionChangeEvent<TaskData>[] = [];
      collection.subscribe((event) => events.push(event));

      await collection.update('task-1', { done: true });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('update');
      expect(events[0]?.entity?.data.done).toBe(true);
    });

    it('should accumulate multiple updates correctly', async () => {
      await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      await collection.update('task-1', { done: true });
      const result = await collection.update('task-1', { priority: 5 });

      expect(result.revision).toBe(3);
      expect(result.data.done).toBe(true);
      expect(result.data.priority).toBe(5);
      expect(result.data.title).toBe('Original');
    });
  });

  // ----------------------------------------------------------------
  // delete (soft)
  // ----------------------------------------------------------------
  describe('delete', () => {
    it('should soft-delete an existing entity', async () => {
      await collection.create('task-1', {
        title: 'To delete',
        done: false,
        priority: 1,
      });

      const deleted = await collection.delete('task-1');

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.revision).toBe(2);
    });

    it('should still be retrievable by ID after soft delete', async () => {
      await collection.create('task-1', {
        title: 'To delete',
        done: false,
        priority: 1,
      });

      await collection.delete('task-1');

      const entity = await collection.get('task-1');
      expect(entity.isDeleted).toBe(true);
    });

    it('should throw NotFoundError when entity does not exist', async () => {
      await expect(collection.delete('non-existent')).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('should emit a delete change event', async () => {
      await collection.create('task-1', {
        title: 'To delete',
        done: false,
        priority: 1,
      });

      const events: CollectionChangeEvent<TaskData>[] = [];
      collection.subscribe((event) => events.push(event));

      const deleted = await collection.delete('task-1');

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('delete');
      expect(events[0]?.entity).toEqual(deleted);
    });
  });

  // ----------------------------------------------------------------
  // query
  // ----------------------------------------------------------------
  describe('query', () => {
    beforeEach(async () => {
      await collection.create('task-1', {
        title: 'Low priority',
        done: false,
        priority: 1,
      });
      await collection.create('task-2', {
        title: 'High priority',
        done: true,
        priority: 5,
      });
      await collection.create('task-3', {
        title: 'Medium priority',
        done: false,
        priority: 3,
      });
    });

    it('should return all entities when no filters applied', async () => {
      const query = createQuery<TaskData>();
      const results = await collection.query(query);

      expect(results).toHaveLength(3);
    });

    it('should filter by eq operator', async () => {
      const query = createQuery<TaskData>().where('done', 'eq', true);
      const results = await collection.query(query);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('task-2');
    });

    it('should filter by gt operator', async () => {
      const query = createQuery<TaskData>().where('priority', 'gt', 2);
      const results = await collection.query(query);

      expect(results).toHaveLength(2);
    });

    it('should combine multiple where clauses with AND', async () => {
      const query = createQuery<TaskData>()
        .where('done', 'eq', false)
        .where('priority', 'gte', 3);
      const results = await collection.query(query);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('task-3');
    });

    it('should sort results ascending', async () => {
      const query = createQuery<TaskData>().orderBy('priority', 'asc');
      const results = await collection.query(query);

      expect(results[0]?.data.priority).toBe(1);
      expect(results[1]?.data.priority).toBe(3);
      expect(results[2]?.data.priority).toBe(5);
    });

    it('should sort results descending', async () => {
      const query = createQuery<TaskData>().orderBy('priority', 'desc');
      const results = await collection.query(query);

      expect(results[0]?.data.priority).toBe(5);
      expect(results[1]?.data.priority).toBe(3);
      expect(results[2]?.data.priority).toBe(1);
    });

    it('should limit results', async () => {
      const query = createQuery<TaskData>().limit(2);
      const results = await collection.query(query);

      expect(results).toHaveLength(2);
    });

    it('should offset results', async () => {
      const query = createQuery<TaskData>()
        .orderBy('priority', 'asc')
        .offset(1);
      const results = await collection.query(query);

      expect(results).toHaveLength(2);
      expect(results[0]?.data.priority).toBe(3);
    });

    it('should combine limit and offset', async () => {
      const query = createQuery<TaskData>()
        .orderBy('priority', 'asc')
        .offset(1)
        .limit(1);
      const results = await collection.query(query);

      expect(results).toHaveLength(1);
      expect(results[0]?.data.priority).toBe(3);
    });

    it('should use createQuery from the collection', async () => {
      const query = collection.createQuery().where('done', 'eq', false);
      const results = await collection.query(query);

      expect(results).toHaveLength(2);
    });

    it('should not return soft-deleted entities', async () => {
      await collection.delete('task-2');

      const query = createQuery<TaskData>();
      const results = await collection.query(query);

      expect(results).toHaveLength(2);
      const ids = results.map((entity) => entity.id);
      expect(ids).not.toContain('task-2');
    });
  });

  // ----------------------------------------------------------------
  // Change observation
  // ----------------------------------------------------------------
  describe('subscribe', () => {
    it('should receive events for creates', async () => {
      const callback = vi.fn();
      collection.subscribe(callback);

      await collection.create('task-1', {
        title: 'New task',
        done: false,
        priority: 1,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'create' }),
      );
    });

    it('should receive events for updates', async () => {
      await collection.create('task-1', {
        title: 'Original',
        done: false,
        priority: 1,
      });

      const callback = vi.fn();
      collection.subscribe(callback);

      await collection.update('task-1', { done: true });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update' }),
      );
    });

    it('should receive events for deletes', async () => {
      await collection.create('task-1', {
        title: 'To delete',
        done: false,
        priority: 1,
      });

      const callback = vi.fn();
      collection.subscribe(callback);

      await collection.delete('task-1');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'delete' }),
      );
    });

    it('should stop receiving events after dispose', async () => {
      const callback = vi.fn();
      const subscription = collection.subscribe(callback);
      subscription.dispose();

      await collection.create('task-1', {
        title: 'New task',
        done: false,
        priority: 1,
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      collection.subscribe(callback1);
      collection.subscribe(callback2);

      await collection.create('task-1', {
        title: 'New task',
        done: false,
        priority: 1,
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should include collection name in events', async () => {
      const callback = vi.fn();
      collection.subscribe(callback);

      await collection.create('task-1', {
        title: 'New task',
        done: false,
        priority: 1,
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ collectionName: COLLECTION_NAME }),
      );
    });

    it('should isolate subscribers between different collections', async () => {
      const otherCollection = new Collection<TaskData>('other', adapter);
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      collection.subscribe(callback1);
      otherCollection.subscribe(callback2);

      await collection.create('task-1', {
        title: 'In first collection',
        done: false,
        priority: 1,
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Sync state
  // ----------------------------------------------------------------
  describe('sync state', () => {
    it('should start in LOCAL_ONLY state', () => {
      expect(collection.syncState).toBe(SYNC_STATE.LOCAL_ONLY);
    });

    it('should allow updating sync state', () => {
      collection.setSyncState(SYNC_STATE.CONNECTING);
      expect(collection.syncState).toBe(SYNC_STATE.CONNECTING);
    });

    it('should track state transitions through the full lifecycle', () => {
      collection.setSyncState(SYNC_STATE.CONNECTING);
      expect(collection.syncState).toBe(SYNC_STATE.CONNECTING);

      collection.setSyncState(SYNC_STATE.CONNECTED);
      expect(collection.syncState).toBe(SYNC_STATE.CONNECTED);

      collection.setSyncState(SYNC_STATE.SYNCING);
      expect(collection.syncState).toBe(SYNC_STATE.SYNCING);

      collection.setSyncState(SYNC_STATE.SYNCED);
      expect(collection.syncState).toBe(SYNC_STATE.SYNCED);
    });

    it('should allow transitioning to ERROR state', () => {
      collection.setSyncState(SYNC_STATE.SYNCING);
      collection.setSyncState(SYNC_STATE.ERROR);
      expect(collection.syncState).toBe(SYNC_STATE.ERROR);
    });

    it('should maintain state independently between collections', () => {
      const otherCollection = new Collection<TaskData>('other', adapter);

      collection.setSyncState(SYNC_STATE.SYNCED);
      otherCollection.setSyncState(SYNC_STATE.LOCAL_ONLY);

      expect(collection.syncState).toBe(SYNC_STATE.SYNCED);
      expect(otherCollection.syncState).toBe(SYNC_STATE.LOCAL_ONLY);
    });
  });

  // ----------------------------------------------------------------
  // COLLECTION_CHANGE_TYPE
  // ----------------------------------------------------------------
  describe('COLLECTION_CHANGE_TYPE', () => {
    it('should have all expected change types', () => {
      expect(COLLECTION_CHANGE_TYPE.CREATE).toBe('create');
      expect(COLLECTION_CHANGE_TYPE.UPDATE).toBe('update');
      expect(COLLECTION_CHANGE_TYPE.DELETE).toBe('delete');
      expect(COLLECTION_CHANGE_TYPE.PURGE).toBe('purge');
    });
  });
});
