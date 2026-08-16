/**
 * In-memory implementation of StorageAdapter for testing.
 * Not for production use.
 */

import type { Entity } from '../src/types.js';
import type { Query } from '../src/query.js';
import type { QueryDefinition } from '../src/query.js';
import type { Transaction } from '../src/transaction.js';
import type { StorageAdapter } from '../src/storage-adapter.js';
import { NotFoundError, TransactionError } from '../src/errors.js';

type Store = Map<string, Map<string, Entity<unknown>>>;

class InMemoryTransaction implements Transaction {
  private committed = false;
  private rolledBack = false;

  constructor(
    private readonly store: Store,
    private readonly originalState: Store,
  ) {}

  async get<T>(collection: string, id: string): Promise<Entity<T>> {
    this.ensureActive();
    const entity = this.store.get(collection)?.get(id);
    if (!entity) {
      throw new NotFoundError(collection, id);
    }
    return entity as Entity<T>;
  }

  async put<T>(collection: string, entity: Entity<T>): Promise<void> {
    this.ensureActive();
    if (!this.store.has(collection)) {
      this.store.set(collection, new Map());
    }
    const map = this.store.get(collection);
    if (map) {
      map.set(entity.id, entity as Entity<unknown>);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    this.ensureActive();
    const entity = this.store.get(collection)?.get(id);
    if (!entity) {
      throw new NotFoundError(collection, id);
    }
    const map = this.store.get(collection);
    if (map) {
      map.delete(id);
    }
  }

  async query<T>(
    collection: string,
    query: Query<T>,
  ): Promise<Entity<T>[]> {
    this.ensureActive();
    const entities = this.store.get(collection);
    if (!entities) {
      return [];
    }
    return filterEntities(entities, query.toDefinition()) as Entity<T>[];
  }

  async commit(): Promise<void> {
    this.ensureActive();
    this.committed = true;
  }

  async rollback(): Promise<void> {
    this.ensureActive();
    // Restore original state
    this.store.clear();
    for (const [col, map] of this.originalState) {
      this.store.set(col, new Map(map));
    }
    this.rolledBack = true;
  }

  private ensureActive(): void {
    if (this.committed) {
      throw new TransactionError('Transaction already committed');
    }
    if (this.rolledBack) {
      throw new TransactionError('Transaction already rolled back');
    }
  }
}

function filterEntities(
  entities: Map<string, Entity<unknown>>,
  def: QueryDefinition,
): Entity<unknown>[] {
  let results = Array.from(entities.values());

  // Filter out soft-deleted
  results = results.filter((e) => !e.isDeleted);

  // Apply filters
  for (const filter of def.filters) {
    results = results.filter((entity) => {
      const fieldValue = (entity.data as Record<string, unknown>)[filter.field];
      return applyOperator(fieldValue, filter.operator, filter.value);
    });
  }

  // Apply sort
  if (def.sort) {
    const { field, direction } = def.sort;
    results.sort((a, b) => {
      const aVal = (a.data as Record<string, unknown>)[field];
      const bVal = (b.data as Record<string, unknown>)[field];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = aVal < bVal ? -1 : 1;
      return direction === 'asc' ? cmp : -cmp;
    });
  }

  // Apply offset
  if (def.offset != null) {
    results = results.slice(def.offset);
  }

  // Apply limit
  if (def.limit != null) {
    results = results.slice(0, def.limit);
  }

  return results;
}

function applyOperator(
  fieldValue: unknown,
  operator: string,
  targetValue: unknown,
): boolean {
  switch (operator) {
    case 'eq':
      return fieldValue === targetValue;
    case 'neq':
      return fieldValue !== targetValue;
    case 'gt':
      return (fieldValue as number) > (targetValue as number);
    case 'gte':
      return (fieldValue as number) >= (targetValue as number);
    case 'lt':
      return (fieldValue as number) < (targetValue as number);
    case 'lte':
      return (fieldValue as number) <= (targetValue as number);
    case 'in':
      return (targetValue as unknown[]).includes(fieldValue);
    case 'contains':
      return (fieldValue as string).includes(targetValue as string);
    default:
      return true;
  }
}

/**
 * In-memory implementation of StorageAdapter for testing.
 * Not for production use.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store: Store = new Map();

  async get<T>(collection: string, id: string): Promise<Entity<T>> {
    const entity = this.store.get(collection)?.get(id);
    if (!entity) {
      throw new NotFoundError(collection, id);
    }
    return entity as Entity<T>;
  }

  async put<T>(collection: string, entity: Entity<T>): Promise<void> {
    if (!this.store.has(collection)) {
      this.store.set(collection, new Map());
    }
    const map = this.store.get(collection);
    if (map) {
      map.set(entity.id, entity as Entity<unknown>);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    const entity = this.store.get(collection)?.get(id);
    if (!entity) {
      throw new NotFoundError(collection, id);
    }
    const map = this.store.get(collection);
    if (map) {
      map.delete(id);
    }
  }

  async query<T>(
    collection: string,
    query: Query<T>,
  ): Promise<Entity<T>[]> {
    const entities = this.store.get(collection);
    if (!entities) {
      return [];
    }
    return filterEntities(entities, query.toDefinition()) as Entity<T>[];
  }

  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    // Deep-copy store for rollback
    const snapshot = new Map<string, Map<string, Entity<unknown>>>();
    for (const [col, map] of this.store) {
      snapshot.set(col, new Map(map));
    }

    const tx = new InMemoryTransaction(this.store, snapshot);
    try {
      const result = await callback(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
