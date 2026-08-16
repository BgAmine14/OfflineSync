/**
 * Query builder for filtering and sorting entities.
 * Intentionally small for v0.1 — advanced queries are non-goals.
 *
 * Query objects are immutable. Each method returns a new Query.
 */

/**
 * Supported comparison operators for queries.
 */
export const QUERY_OPERATOR = {
  /** Equal */
  EQ: 'eq',
  /** Not equal */
  NEQ: 'neq',
  /** Greater than */
  GT: 'gt',
  /** Greater than or equal */
  GTE: 'gte',
  /** Less than */
  LT: 'lt',
  /** Less than or equal */
  LTE: 'lte',
  /** Value is in an array of values */
  IN: 'in',
  /** String contains substring (case-sensitive) */
  CONTAINS: 'contains',
} as const;

export type QueryOperator =
  (typeof QUERY_OPERATOR)[keyof typeof QUERY_OPERATOR];

/** Sort direction for query results. */
export type SortDirection = 'asc' | 'desc';

/** A single filter clause in a query. */
export interface QueryFilter {
  readonly field: string;
  readonly operator: QueryOperator;
  readonly value: unknown;
}

/** Sort specification for a query. */
export interface QuerySort {
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * Serialized query definition that can be passed to a StorageAdapter.
 * Built by chaining Query methods; consumed by StorageAdapter.query().
 */
export interface QueryDefinition {
  readonly filters: readonly QueryFilter[];
  readonly sort: QuerySort | null;
  readonly limit: number | null;
  readonly offset: number | null;
}

/**
 * Query builder for filtering and sorting entities.
 *
 * Intentionally small for v0.1. Multiple where() calls are
 * combined with AND. No OR, nested fields, or aggregations.
 *
 * @typeParam T - The shape of the entity data being queried.
 */
export interface Query<T> {
  /**
   * Filter entities by a field value.
   * Multiple where() calls are combined with AND.
   */
  where<K extends keyof T & string>(
    field: K,
    operator: QueryOperator,
    value: T[K],
  ): Query<T>;

  /**
   * Sort results by a field.
   */
  orderBy<K extends keyof T & string>(
    field: K,
    direction: SortDirection,
  ): Query<T>;

  /**
   * Limit the number of results.
   */
  limit(n: number): Query<T>;

  /**
   * Skip the first N results.
   */
  offset(n: number): Query<T>;

  /**
   * Return the serialized query definition.
   */
  toDefinition(): QueryDefinition;
}
