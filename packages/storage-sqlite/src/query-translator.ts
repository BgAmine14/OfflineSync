/**
 * Translates a QueryDefinition into a parameterized SQL query.
 *
 * The `data` field is stored as JSON text. To query fields
 * inside `data`, we use SQLite's `json_extract()` function.
 *
 * Top-level metadata fields (id, revision, createdAt, updatedAt,
 * isDeleted) are stored as separate columns and queried directly.
 */

import type { QueryDefinition, QueryOperator } from '@offlinesync/storage';

/** Metadata field names stored as separate columns. */
const METADATA_FIELDS = new Set([
  'id',
  'revision',
  'createdAt',
  'updatedAt',
  'isDeleted',
]);

/**
 * SQL operator mapping for query operators.
 * For `in`, the placeholder is special (multiple params).
 */
const OPERATOR_MAP: Record<QueryOperator, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'IN',
  contains: 'LIKE',
};

/**
 * Translates a QueryDefinition into a SQL WHERE clause and parameters.
 *
 * @returns An object with `whereClause` (including 'WHERE'),
 *   `params`, `orderByClause` (including 'ORDER BY' or empty),
 *   `limitClause`, and `offsetClause`.
 */
export function translateQuery(
  def: QueryDefinition,
): {
  whereClause: string;
  params: unknown[];
  orderByClause: string;
  limitClause: string;
  offsetClause: string;
} {
  const parts: string[] = [];
  const params: unknown[] = [];

  // Always exclude soft-deleted entities
  parts.push('is_deleted = 0');

  for (const filter of def.filters) {
    const sqlExpr = toSqlExpression(filter.field);
    const opSql = OPERATOR_MAP[filter.operator];

    if (filter.operator === 'in') {
      const values = filter.value as unknown[];
      if (values.length === 0) {
        // Empty IN clause never matches
        parts.push('1 = 0');
      } else {
        const converted = values.map(toSqlValue);
        const placeholders = converted.map(() => '?').join(', ');
        parts.push(`(${sqlExpr} IN (${placeholders}))`);
        params.push(...converted);
      }
    } else if (filter.operator === 'contains') {
      parts.push(`(${sqlExpr} LIKE ?)`);
      params.push(`%${filter.value}%`);
    } else {
      parts.push(`(${sqlExpr} ${opSql} ?)`);
      params.push(toSqlValue(filter.value));
    }
  }

  const whereClause = `WHERE ${parts.join(' AND ')}`;

  let orderByClause = '';
  if (def.sort) {
    const sqlExpr = toSqlExpression(def.sort.field);
    const direction = def.sort.direction === 'desc' ? 'DESC' : 'ASC';
    orderByClause = `ORDER BY ${sqlExpr} ${direction}`;
  }

  // SQLite requires LIMIT when using OFFSET.
  // If only offset is specified, use a very large default limit.
  let limitClause = '';
  let offsetClause = '';
  if (def.limit !== null) {
    limitClause = 'LIMIT ?';
  } else if (def.offset !== null) {
    limitClause = 'LIMIT -1';
  }
  if (def.offset !== null) {
    offsetClause = 'OFFSET ?';
  }

  return { whereClause, params, orderByClause, limitClause, offsetClause };
}

/**
 * Returns the SQL expression for a field name.
 * Metadata fields map to columns; data fields use json_extract.
 */
function toSqlExpression(field: string): string {
  if (METADATA_FIELDS.has(field)) {
    // Map camelCase metadata fields to snake_case columns
    return CAMEL_TO_SNAKE[field] ?? field;
  }
  // Data field — use json_extract on the data column
  return `json_extract(data, '$.${field}')`;
}

/**
 * Mapping from camelCase metadata field names to snake_case columns.
 */
const CAMEL_TO_SNAKE: Record<string, string> = {
  id: 'id',
  revision: 'revision',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  isDeleted: 'is_deleted',
};

/**
 * Convert a JavaScript value to a SQLite-compatible bind value.
 *
 * SQLite's better-sqlite3 driver can only bind numbers, strings,
 * bigints, buffers, and null. JavaScript booleans must be converted
 * to 0/1 integers.
 */
function toSqlValue(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}
