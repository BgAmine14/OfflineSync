/**
 * Concrete query builder implementation.
 * Provides an immutable, chainable API for building queries.
 */

import type { Query, QueryDefinition, QueryFilter, QuerySort } from './query.js';
import type { SortDirection, QueryOperator } from './query.js';

export class QueryBuilder<T> implements Query<T> {
  private readonly filters: QueryFilter[];
  private readonly sort: QuerySort | null;
  private readonly limitValue: number | null;
  private readonly offsetValue: number | null;

  constructor(
    filters: QueryFilter[] = [],
    sort: QuerySort | null = null,
    limitValue: number | null = null,
    offsetValue: number | null = null,
  ) {
    this.filters = filters;
    this.sort = sort;
    this.limitValue = limitValue;
    this.offsetValue = offsetValue;
  }

  where<K extends keyof T & string>(
    field: K,
    operator: QueryOperator,
    value: T[K],
  ): Query<T> {
    const filter: QueryFilter = { field, operator, value };
    return new QueryBuilder(
      [...this.filters, filter],
      this.sort,
      this.limitValue,
      this.offsetValue,
    );
  }

  orderBy<K extends keyof T & string>(
    field: K,
    direction: SortDirection,
  ): Query<T> {
    return new QueryBuilder(
      this.filters,
      { field, direction },
      this.limitValue,
      this.offsetValue,
    );
  }

  limit(n: number): Query<T> {
    return new QueryBuilder(
      this.filters,
      this.sort,
      n,
      this.offsetValue,
    );
  }

  offset(n: number): Query<T> {
    return new QueryBuilder(
      this.filters,
      this.sort,
      this.limitValue,
      n,
    );
  }

  toDefinition(): QueryDefinition {
    return {
      filters: this.filters,
      sort: this.sort,
      limit: this.limitValue,
      offset: this.offsetValue,
    };
  }
}

/**
 * Create a new query for the given data shape.
 */
export function createQuery<T>(): Query<T> {
  return new QueryBuilder<T>();
}
