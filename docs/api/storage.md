---
title: '@offlinesync/storage'
---

# @offlinesync/storage

Pure TypeScript — **zero runtime dependencies**. Defines the storage contract.

## Core Types

| Export | Kind | Description |
|---|---|---|
| `Entity<T>` | type | Core data structure: `id`, `data: T`, `revision`, `createdAt`, `updatedAt`, `isDeleted` |
| `Cursor` | type | Opaque string cursor for incremental sync pagination |

## StorageAdapter Interface

| Method | Returns | Description |
|---|---|---|
| `get<T>(collection, id)` | `Promise<Entity<T>>` | Read a single entity |
| `put<T>(collection, entity)` | `Promise<void>` | Create or replace an entity |
| `delete(collection, id)` | `Promise<void>` | Delete an entity |
| `query<T>(collection, query)` | `Promise<Entity<T>[]>` | Query entities |
| `transaction<T>(callback)` | `Promise<T>` | Atomic read-write transaction |
| `close()` | `Promise<void>` | Close the storage connection |

## Transaction Interface

| Method | Returns | Description |
|---|---|---|
| `get<T>(collection, id)` | `Promise<Entity<T>>` | Read within transaction |
| `put<T>(collection, entity)` | `Promise<void>` | Write within transaction |
| `delete(collection, id)` | `Promise<void>` | Delete within transaction |
| `query<T>(collection, query)` | `Promise<Entity<T>[]>` | Query within transaction |
| `commit()` | `Promise<void>` | Commit transaction |
| `rollback()` | `Promise<void>` | Rollback transaction |

## Query Builder

```typescript
import { createQuery } from '@offlinesync/storage'

const results = await collection.query(
  createQuery<Task>()
    .filter('done', 'eq', false)
    .sort('priority', 'asc')
    .offset(0)
    .limit(20)
    .build()
)
```

| Export | Kind | Description |
|---|---|---|
| `QueryBuilder<T>` | class | Fluent builder for constructing queries |
| `createQuery<T>()` | function | Creates a new `QueryBuilder<T>` instance |

### Filter Operators

`eq` · `neq` · `gt` · `gte` · `lt` · `lte` · `in` · `contains`

## Errors

| Export | Extends | Description |
|---|---|---|
| `StorageError` | `Error` | Base storage error with `code` and `collection` |
| `NotFoundError` | `StorageError` | Entity not found (`code: 'NOT_FOUND'`) |
| `TransactionError` | `StorageError` | Transaction violation (`code: 'TRANSACTION_ERROR'`) |
| `QueryError` | `StorageError` | Query execution failure (`code: 'QUERY_ERROR'`) |
| `ConstraintError` | `StorageError` | Constraint violation (`code: 'CONSTRAINT_ERROR'`) |
