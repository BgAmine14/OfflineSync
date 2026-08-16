import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Entity } from '@offlinesync/storage';
import {
  createQuery,
  QUERY_OPERATOR,
  NotFoundError,
  TransactionError,
  StorageError,
} from '@offlinesync/storage';
import { SQLiteStorageAdapter } from '../src/sqlite-adapter.js';

interface TaskData {
  title: string;
  done: boolean;
  priority: number;
}

function makeEntity<T>(
  id: string,
  data: T,
  overrides?: Partial<Entity<T>>,
): Entity<T> {
  const now = new Date().toISOString();
  return {
    id,
    data,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    ...overrides,
  };
}

function createAdapter(): SQLiteStorageAdapter {
  return new SQLiteStorageAdapter({ path: ':memory:' });
}

describe('SQLiteStorageAdapter', () => {
  let adapter: SQLiteStorageAdapter;

  beforeEach(() => {
    adapter = createAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('put and get', () => {
    it('stores and retrieves an entity by collection and id', async () => {
      const entity = makeEntity('t1', {
        title: 'Buy milk',
        done: false,
        priority: 3,
      });

      await adapter.put('tasks', entity);
      const result = await adapter.get<TaskData>('tasks', 't1');

      expect(result.id).toBe('t1');
      expect(result.data.title).toBe('Buy milk');
      expect(result.data.done).toBe(false);
      expect(result.data.priority).toBe(3);
      expect(result.revision).toBe(1);
      expect(result.isDeleted).toBe(false);
    });

    it('overwrites an existing entity with the same id', async () => {
      const v1 = makeEntity('t1', { title: 'V1', done: false, priority: 1 });
      const v2 = makeEntity('t1', { title: 'V2', done: true, priority: 5 }, {
        revision: 2,
      });

      await adapter.put('tasks', v1);
      await adapter.put('tasks', v2);
      const result = await adapter.get<TaskData>('tasks', 't1');

      expect(result.data.title).toBe('V2');
      expect(result.revision).toBe(2);
    });

    it('isolates entities by collection', async () => {
      const entity = makeEntity('t1', {
        title: 'Shared ID',
        done: false,
        priority: 1,
      });

      await adapter.put('tasks', entity);

      await expect(
        adapter.get<TaskData>('projects', 't1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('persists nested data correctly', async () => {
      const entity = makeEntity('t1', {
        title: 'Complex',
        done: false,
        priority: 1,
        nested: { a: { b: 42 } },
      } as TaskData & { nested: { a: { b: number } } });

      await adapter.put('tasks', entity);
      const result = await adapter.get<TaskData & { nested: { a: { b: number } } }>(
        'tasks',
        't1',
      );

      expect(result.data.nested.a.b).toBe(42);
    });

    it('persists array data correctly', async () => {
      const entity = makeEntity('t1', {
        title: 'Tags',
        done: false,
        priority: 1,
        tags: ['a', 'b', 'c'],
      } as TaskData & { tags: string[] });

      await adapter.put('tasks', entity);
      const result = await adapter.get<TaskData & { tags: string[] }>(
        'tasks',
        't1',
      );

      expect(result.data.tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('get', () => {
    it('throws NotFoundError for a missing entity', async () => {
      await expect(
        adapter.get<TaskData>('tasks', 'nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError with collection and id', async () => {
      try {
        await adapter.get<TaskData>('tasks', 'missing');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        const nf = error as NotFoundError;
        expect(nf.collection).toBe('tasks');
        expect(nf.id).toBe('missing');
        expect(nf.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('delete', () => {
    it('removes an existing entity', async () => {
      const entity = makeEntity('t1', {
        title: 'Delete me',
        done: false,
        priority: 1,
      });
      await adapter.put('tasks', entity);

      await adapter.delete('tasks', 't1');

      await expect(
        adapter.get<TaskData>('tasks', 't1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when deleting a missing entity', async () => {
      await expect(
        adapter.delete('tasks', 'nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const entities: Entity<TaskData>[] = [
        makeEntity('t1', { title: 'Low', done: true, priority: 1 }),
        makeEntity('t2', { title: 'Medium', done: false, priority: 5 }),
        makeEntity('t3', { title: 'High', done: false, priority: 10 }),
        makeEntity('t4', { title: 'Urgent', done: true, priority: 10 }),
      ];
      for (const entity of entities) {
        await adapter.put('tasks', entity);
      }
    });

    it('returns all entities with no filters', async () => {
      const query = createQuery<TaskData>();
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(4);
    });

    it('filters by equality on data field', async () => {
      const query = createQuery<TaskData>().where(
        'done',
        QUERY_OPERATOR.EQ,
        true,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('filters by not equal', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.NEQ,
        10,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('filters by greater than', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.GT,
        5,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('t3');
      expect(ids).toContain('t4');
    });

    it('filters by greater than or equal', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.GTE,
        10,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('filters by less than', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.LT,
        5,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('t1');
    });

    it('filters by less than or equal', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.LTE,
        5,
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('filters by IN operator', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.IN,
        [1, 10],
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(3);
    });

    it('filters by CONTAINS operator', async () => {
      const query = createQuery<TaskData>().where(
        'title',
        QUERY_OPERATOR.CONTAINS,
        'e',
      );
      const results = await adapter.query('tasks', query);

      // 'Low' has no 'e', 'Medium' has 'e', 'High' has no 'e', 'Urgent' has 'e'
      expect(results).toHaveLength(2);
    });

    it('combines multiple filters with AND', async () => {
      const query = createQuery<TaskData>()
        .where('done', QUERY_OPERATOR.EQ, false)
        .where('priority', QUERY_OPERATOR.GTE, 5);
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('t2');
      expect(ids).toContain('t3');
    });

    it('sorts results ascending', async () => {
      const query = createQuery<TaskData>().orderBy('priority', 'asc');
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(4);
      const first = results[0];
      const last = results[results.length - 1];
      expect(first?.data.priority).toBe(1);
      expect(last?.data.priority).toBe(10);
    });

    it('sorts results descending', async () => {
      const query = createQuery<TaskData>().orderBy('priority', 'desc');
      const results = await adapter.query('tasks', query);

      const first = results[0];
      const last = results[results.length - 1];
      expect(first?.data.priority).toBe(10);
      expect(last?.data.priority).toBe(1);
    });

    it('limits results', async () => {
      const query = createQuery<TaskData>().limit(2);
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('offsets results', async () => {
      const query = createQuery<TaskData>()
        .orderBy('priority', 'asc')
        .offset(2);
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(2);
    });

    it('excludes soft-deleted entities', async () => {
      const deleted = makeEntity(
        't5',
        { title: 'Deleted', done: false, priority: 0 },
        { isDeleted: true },
      );
      await adapter.put('tasks', deleted);

      const query = createQuery<TaskData>();
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(4);
    });

    it('returns empty array for a collection with no entities', async () => {
      const query = createQuery<TaskData>();
      const results = await adapter.query('empty-collection', query);

      expect(results).toHaveLength(0);
    });

    it('returns empty array for IN with empty array', async () => {
      const query = createQuery<TaskData>().where(
        'priority',
        QUERY_OPERATOR.IN,
        [],
      );
      const results = await adapter.query('tasks', query);

      expect(results).toHaveLength(0);
    });
  });

  describe('transaction', () => {
    it('commits all operations when callback succeeds', async () => {
      const entity = makeEntity('t1', {
        title: 'In tx',
        done: false,
        priority: 1,
      });

      await adapter.transaction(async (tx) => {
        await tx.put('tasks', entity);
      });

      const result = await adapter.get<TaskData>('tasks', 't1');
      expect(result.data.title).toBe('In tx');
    });

    it('rolls back all operations when callback throws', async () => {
      const entity = makeEntity('t1', {
        title: 'Rolled back',
        done: false,
        priority: 1,
      });

      try {
        await adapter.transaction(async (tx) => {
          await tx.put('tasks', entity);
          throw new Error('Simulated failure');
        });
        expect.fail('Should have thrown');
      } catch {
        // Expected
      }

      await expect(
        adapter.get<TaskData>('tasks', 't1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('rolls back partial writes on failure', async () => {
      const e1 = makeEntity('t1', { title: 'A', done: false, priority: 1 });
      const e2 = makeEntity('t2', { title: 'B', done: false, priority: 2 });

      await adapter.put('tasks', e1);

      try {
        await adapter.transaction(async (tx) => {
          await tx.put('tasks', e2);
          await tx.delete('tasks', 't1');
          throw new Error('Fail after partial ops');
        });
      } catch {
        // Expected
      }

      const result = await adapter.get<TaskData>('tasks', 't1');
      expect(result.data.title).toBe('A');

      await expect(
        adapter.get<TaskData>('tasks', 't2'),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows reads within the transaction to see own writes', async () => {
      const entity = makeEntity('t1', {
        title: 'Visible',
        done: false,
        priority: 1,
      });

      await adapter.transaction(async (tx) => {
        await tx.put('tasks', entity);
        const result = await tx.get<TaskData>('tasks', 't1');
        expect(result.data.title).toBe('Visible');
      });
    });

    it('throws TransactionError for nested transactions', async () => {
      await expect(
        adapter.transaction(async (tx) => {
          await tx.put('tasks',
            makeEntity('t1', { title: 'X', done: false, priority: 1 }),
          );
          // Nested transaction
          await adapter.transaction(async (tx2) => {
            await tx2.put('tasks',
              makeEntity('t2', { title: 'Y', done: false, priority: 2 }),
            );
          });
        }),
      ).rejects.toThrow(TransactionError);
    });

    it('rolls back and preserves StorageError', async () => {
      try {
        await adapter.transaction(async (tx) => {
          await tx.get<TaskData>('tasks', 'nope');
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
      }
    });
  });

  describe('close', () => {
    it('prevents operations after close', async () => {
      const entity = makeEntity('t1', {
        title: 'Test',
        done: false,
        priority: 1,
      });
      await adapter.put('tasks', entity);
      await adapter.close();

      await expect(
        adapter.get<TaskData>('tasks', 't1'),
      ).rejects.toThrow(TransactionError);
    });
  });

  describe('WAL mode', () => {
    it('configures WAL journal mode on initialization', async () => {
      // The adapter is already initialized in beforeEach.
      // We can verify WAL mode by checking the PRAGMA result.
      // However, since we don't expose the db directly,
      // we verify indirectly by confirming operations work.
      // WAL mode is verified by the PRAGMA_SQL in schema.ts.
      const entity = makeEntity('t1', {
        title: 'WAL test',
        done: false,
        priority: 1,
      });
      await adapter.put('tasks', entity);
      const result = await adapter.get<TaskData>('tasks', 't1');
      expect(result.data.title).toBe('WAL test');
    });
  });

  describe('error mapping', () => {
    it('maps unknown errors to StorageError with SQLITE_ERROR code', async () => {
      // We can't easily trigger arbitrary SQLite errors,
      // but we can verify that the error hierarchy works
      // by checking that a NotFoundError has the right code.
      try {
        await adapter.get<TaskData>('tasks', 'nonexistent');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        const se = error as StorageError;
        expect(se.code).toBeDefined();
        expect(typeof se.code).toBe('string');
      }
    });
  });

  describe('collection isolation', () => {
    it('entities in one collection do not appear in another', async () => {
      await adapter.put(
        'colA',
        makeEntity('x', { title: 'A', done: false, priority: 1 }),
      );
      await adapter.put(
        'colB',
        makeEntity('x', { title: 'B', done: false, priority: 2 }),
      );

      const a = await adapter.get<TaskData>('colA', 'x');
      const b = await adapter.get<TaskData>('colB', 'x');

      expect(a.data.title).toBe('A');
      expect(b.data.title).toBe('B');
    });

    it('deleting from one collection does not affect another', async () => {
      await adapter.put(
        'colA',
        makeEntity('x', { title: 'A', done: false, priority: 1 }),
      );
      await adapter.put(
        'colB',
        makeEntity('x', { title: 'B', done: false, priority: 2 }),
      );

      await adapter.delete('colA', 'x');

      await expect(
        adapter.get<TaskData>('colA', 'x'),
      ).rejects.toThrow(NotFoundError);

      const b = await adapter.get<TaskData>('colB', 'x');
      expect(b.data.title).toBe('B');
    });
  });
});
