import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity, StorageAdapter } from '../src/index.js';
import {
  createQuery,
  QUERY_OPERATOR,
  NotFoundError,
  TransactionError,
  QueryError,
  ConstraintError,
} from '../src/index.js';
import { InMemoryStorageAdapter } from './in-memory-storage-adapter.js';

interface ProductData {
  name: string;
  price: number;
  category: string;
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

describe('StorageAdapter contract', () => {
  let adapter: StorageAdapter;

  beforeEach(async () => {
    adapter = new InMemoryStorageAdapter();
  });

  describe('put and get', () => {
    it('stores and retrieves an entity by collection and id', async () => {
      const entity = makeEntity('p1', {
        name: 'Widget',
        price: 10,
        category: 'hardware',
      });

      await adapter.put('products', entity);
      const result = await adapter.get<ProductData>('products', 'p1');

      expect(result.id).toBe('p1');
      expect(result.data.name).toBe('Widget');
      expect(result.data.price).toBe(10);
      expect(result.revision).toBe(1);
      expect(result.isDeleted).toBe(false);
    });

    it('overwrites an existing entity with the same id', async () => {
      const v1 = makeEntity('p1', { name: 'V1', price: 5, category: 'a' });
      const v2 = makeEntity('p1', { name: 'V2', price: 15, category: 'b' }, { revision: 2 });

      await adapter.put('products', v1);
      await adapter.put('products', v2);
      const result = await adapter.get<ProductData>('products', 'p1');

      expect(result.data.name).toBe('V2');
      expect(result.revision).toBe(2);
    });

    it('isolates entities by collection', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });

      await adapter.put('products', entity);

      await expect(
        adapter.get<ProductData>('orders', 'p1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('get', () => {
    it('throws NotFoundError for a missing entity', async () => {
      await expect(
        adapter.get<ProductData>('products', 'nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError with collection and id in the error', async () => {
      try {
        await adapter.get<ProductData>('products', 'missing');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        const nf = error as NotFoundError;
        expect(nf.collection).toBe('products');
        expect(nf.id).toBe('missing');
        expect(nf.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('delete', () => {
    it('removes an existing entity', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });
      await adapter.put('products', entity);

      await adapter.delete('products', 'p1');

      await expect(
        adapter.get<ProductData>('products', 'p1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when deleting a missing entity', async () => {
      await expect(
        adapter.delete('products', 'nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const entities: Entity<ProductData>[] = [
        makeEntity('p1', { name: 'Widget', price: 10, category: 'hardware' }),
        makeEntity('p2', { name: 'Gadget', price: 25, category: 'hardware' }),
        makeEntity('p3', { name: 'Doohickey', price: 5, category: 'software' }),
        makeEntity('p4', { name: 'Thingamajig', price: 50, category: 'hardware' }),
      ];
      for (const entity of entities) {
        await adapter.put('products', entity);
      }
    });

    it('returns all entities with no filters', async () => {
      const query = createQuery<ProductData>();
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(4);
    });

    it('filters by equality', async () => {
      const query = createQuery<ProductData>().where(
        'category',
        QUERY_OPERATOR.EQ,
        'software',
      );
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(1);
      const first = results[0];
      expect(first?.id).toBe('p3');
    });

    it('filters by greater than', async () => {
      const query = createQuery<ProductData>().where(
        'price',
        QUERY_OPERATOR.GT,
        10,
      );
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('p2');
      expect(ids).toContain('p4');
    });

    it('combines multiple filters with AND', async () => {
      const query = createQuery<ProductData>()
        .where('category', QUERY_OPERATOR.EQ, 'hardware')
        .where('price', QUERY_OPERATOR.GTE, 25);
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('p2');
      expect(ids).toContain('p4');
    });

    it('sorts results ascending', async () => {
      const query = createQuery<ProductData>().orderBy('price', 'asc');
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(4);
      const first = results[0];
      const last = results[results.length - 1];
      expect(first?.data.price).toBe(5);
      expect(last?.data.price).toBe(50);
    });

    it('sorts results descending', async () => {
      const query = createQuery<ProductData>().orderBy('price', 'desc');
      const results = await adapter.query('products', query);

      const first = results[0];
      const last = results[results.length - 1];
      expect(first?.data.price).toBe(50);
      expect(last?.data.price).toBe(5);
    });

    it('limits results', async () => {
      const query = createQuery<ProductData>().limit(2);
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(2);
    });

    it('offsets results', async () => {
      const query = createQuery<ProductData>()
        .orderBy('price', 'asc')
        .offset(2);
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(2);
      const first = results[0];
      expect(first?.data.price).toBe(25);
    });

    it('excludes soft-deleted entities', async () => {
      const deleted = makeEntity(
        'p5',
        { name: 'Deleted', price: 1, category: 'x' },
        { isDeleted: true },
      );
      await adapter.put('products', deleted);

      const query = createQuery<ProductData>();
      const results = await adapter.query('products', query);

      expect(results).toHaveLength(4);
    });

    it('returns empty array for a collection with no entities', async () => {
      const query = createQuery<ProductData>();
      const results = await adapter.query('empty-collection', query);

      expect(results).toHaveLength(0);
    });
  });

  describe('transaction', () => {
    it('commits all operations when callback succeeds', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });

      await adapter.transaction(async (tx) => {
        await tx.put('products', entity);
      });

      const result = await adapter.get<ProductData>('products', 'p1');
      expect(result.data.name).toBe('Widget');
    });

    it('rolls back all operations when callback throws', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });

      try {
        await adapter.transaction(async (tx) => {
          await tx.put('products', entity);
          throw new Error('Simulated failure');
        });
        expect.fail('Should have thrown');
      } catch {
        // Expected
      }

      await expect(
        adapter.get<ProductData>('products', 'p1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('rolls back partial writes on failure', async () => {
      const e1 = makeEntity('p1', { name: 'A', price: 1, category: 'x' });
      const e2 = makeEntity('p2', { name: 'B', price: 2, category: 'x' });

      // Put e1 first so we can verify rollback
      await adapter.put('products', e1);

      try {
        await adapter.transaction(async (tx) => {
          await tx.put('products', e2);
          await tx.delete('products', 'p1');
          throw new Error('Fail after partial ops');
        });
      } catch {
        // Expected
      }

      // e1 should still exist (rollback restored it)
      const result = await adapter.get<ProductData>('products', 'p1');
      expect(result.data.name).toBe('A');

      // e2 should not exist (was only in the transaction)
      await expect(
        adapter.get<ProductData>('products', 'p2'),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows reads within the transaction to see own writes', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });

      await adapter.transaction(async (tx) => {
        await tx.put('products', entity);
        const result = await tx.get<ProductData>('products', 'p1');
        expect(result.data.name).toBe('Widget');
      });
    });
  });

  describe('close', () => {
    it('clears all stored data', async () => {
      const entity = makeEntity('p1', { name: 'Widget', price: 10, category: 'a' });
      await adapter.put('products', entity);

      await adapter.close();

      await expect(
        adapter.get<ProductData>('products', 'p1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Error hierarchy', () => {
    it('all errors have a code property', () => {
      const errors = [
        new NotFoundError('col', 'id'),
        new TransactionError('msg'),
        new QueryError('msg'),
        new ConstraintError('msg'),
      ];

      for (const error of errors) {
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe('string');
      }
    });

    it('NotFoundError carries collection and id', () => {
      const error = new NotFoundError('products', 'p1');
      expect(error.collection).toBe('products');
      expect(error.id).toBe('p1');
      expect(error.message).toContain('products');
      expect(error.message).toContain('p1');
    });

    it('TransactionError carries reason', () => {
      const error = new TransactionError('failed', 'deadlock');
      expect(error.reason).toBe('deadlock');
    });

    it('QueryError carries queryDetails', () => {
      const error = new QueryError('bad query', 'field not indexed');
      expect(error.queryDetails).toBe('field not indexed');
    });

    it('ConstraintError carries constraint name', () => {
      const error = new ConstraintError('dup', 'unique_id');
      expect(error.constraint).toBe('unique_id');
    });
  });

  describe('Query builder', () => {
    it('returns an immutable query where each method returns a new instance', () => {
      const q1 = createQuery<ProductData>();
      const q2 = q1.where('name', QUERY_OPERATOR.EQ, 'test');

      expect(q1).not.toBe(q2);
      expect(q1.toDefinition().filters).toHaveLength(0);
      expect(q2.toDefinition().filters).toHaveLength(1);
    });

    it('produces correct QueryDefinition', () => {
      const query = createQuery<ProductData>()
        .where('price', QUERY_OPERATOR.GTE, 10)
        .where('category', QUERY_OPERATOR.EQ, 'hardware')
        .orderBy('price', 'desc')
        .limit(10)
        .offset(5);

      const def = query.toDefinition();

      expect(def.filters).toHaveLength(2);
      expect(def.sort).toEqual({ field: 'price', direction: 'desc' });
      expect(def.limit).toBe(10);
      expect(def.offset).toBe(5);
    });
  });
});
