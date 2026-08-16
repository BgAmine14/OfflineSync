---
title: '@offlinesync/core'
---

# @offlinesync/core

The primary developer-facing package. Re-exports key types from `@offlinesync/storage`, `@offlinesync/conflict`, and `@offlinesync/protocol`.

## Collection

### `Collection<T>`

Typed CRUD operations and change observation for a named entity collection.

```typescript
const tasks = new Collection<Task>('tasks', storage, {
  mutationRecorder: recorder,
  mutationQueue: queue,
})
```

| Method | Returns | Description |
|---|---|---|
| `get(id)` | `Promise<Entity<T>>` | Get entity by ID (throws if not found) |
| `getOrNull(id)` | `Promise<Entity<T> \| null>` | Get entity or null |
| `query(query)` | `Promise<Entity<T>[]>` | Query with filters, sort, pagination |
| `create(id, data)` | `Promise<Entity<T>>` | Create new entity (fails if exists) |
| `put(entity)` | `Promise<Entity<T>>` | Create or replace entity |
| `update(id, changes)` | `Promise<Entity<T>>` | Partial field update |
| `delete(id)` | `Promise<void>` | Soft-delete entity |
| `subscribe(callback)` | `CollectionSubscription` | Observe change events |
| `getSyncState()` | `SyncState` | Current sync state |
| `setSyncState(state)` | `void` | Update sync state |

### Collection Events

| Export | Description |
|---|---|
| `COLLECTION_CHANGE_TYPE` | `{ CREATE, UPDATE, DELETE, PURGE }` |
| `CollectionChangeEvent<T>` | `{ type, collectionName, entity }` |
| `CollectionSubscription` | `{ dispose(): void }` |

## MutationRecorder

### `new MutationRecorder(options)`

| Method | Returns | Description |
|---|---|---|
| `recordSet(collectionName, entity)` | `Mutation` | Record a full entity replacement |
| `recordUpdate(collectionName, entityId, changes)` | `Mutation` | Record a partial field update |
| `recordDelete(collectionName, entityId)` | `Mutation` | Record a deletion |
| `initializeSequence(collectionName, maxSeq)` | `void` | Init sequence tracker from stored state |

## MutationQueue

### `new MutationQueue(options)`

| Method | Returns | Description |
|---|---|---|
| `enqueue(mutation, tx?)` | `Promise<void>` | Add mutation (optionally in a transaction) |
| `dequeuePending(limit)` | `Promise<Mutation[]>` | Get pending mutations in order |
| `acknowledge(mutationId)` | `Promise<void>` | Mark as acknowledged |
| `markInFlight(mutationId)` | `Promise<void>` | Mark as in-flight |
| `markFailed(mutationId, error)` | `Promise<void>` | Mark as failed |
| `markConflict(mutationId)` | `Promise<void>` | Mark as conflicted |
| `retry(mutationId)` | `Promise<void>` | Retry a failed mutation |
| `resolveConflict(mutationId, updates?)` | `Promise<void>` | Resolve conflict and re-queue |
| `pendingCount()` | `Promise<number>` | Count non-terminal mutations |

## SyncEngine

### `new SyncEngine(options)`

| Option | Type | Description |
|---|---|---|
| `clientId` | `string` | Unique client identifier |
| `storage` | `StorageAdapter` | Storage backend |
| `mutationQueue` | `MutationQueue` | Durable mutation queue |
| `transport` | `SyncTransport` | Server communication |
| `conflictResolver` | `ConflictResolutionManager` | Conflict routing |
| `batchSize` | `number` | Max mutations per cycle (default: 50) |

| Method | Returns | Description |
|---|---|---|
| `sync()` | `Promise<SyncCycleResult>` | Run a single sync cycle |
| `snapshotSync(collections)` | `Promise<void>` | Full-state snapshot sync |

### `SyncCycleResult`

| Field | Type | Description |
|---|---|---|
| `acknowledgedMutations` | `number` | Mutations confirmed by server |
| `appliedChanges` | `number` | Remote changes applied locally |
| `conflicts` | `ConflictEvent[]` | Unresolved conflicts |
| `errors` | `Array<{ code, message }>` | Non-fatal errors |

## SyncScheduler

### `new SyncScheduler(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `SyncEngine` | — | The sync engine |
| `baseIntervalMs` | `number` | `30_000` | Base sync interval |
| `backoffMultiplier` | `number` | `2` | Exponential backoff multiplier |
| `maxBackoffMs` | `number` | `300_000` | Maximum backoff cap |

| Method | Returns | Description |
|---|---|---|
| `start()` | `void` | Begin periodic sync |
| `stop()` | `void` | Stop periodic sync |
| `triggerSync()` | `void` | Trigger immediate sync |
| `dispose()` | `void` | Release all resources |

## RecoveryManager

### `new RecoveryManager(options)`

| Method | Returns | Description |
|---|---|---|
| `recover()` | `Promise<RecoveryResult>` | Detect and recover from interrupted sync |

Repairs: IN_FLIGHT → PENDING reset, sequence gap detection, orphaned mutation detection.

## IntegrityChecker

### `new IntegrityChecker(options)`

| Method | Returns | Description |
|---|---|---|
| `check()` | `Promise<IntegrityCheckResult>` | Validate data consistency |
| `repair()` | `Promise<IntegrityCheckResult>` | Check and repair issues |

## SyncTransport (interface)

| Export | Kind | Description |
|---|---|---|
| `SyncTransport` | interface | `getVersionInfo()`, `sendSync()`, `sendSnapshot()` |
| `StubSyncTransport` | class | In-memory transport for testing |

## Type Converters

| Export | Description |
|---|---|
| `clientMutationToProtocol(mutation)` | Convert client `Mutation` to `ProtocolMutation` |
| `buildSyncRequest(clientId, mutations, cursor)` | Build a `SyncRequest` |
| `protocolEntityToClient(entity)` | Convert `ProtocolEntity` to `Entity` |
| `extractAcknowledgedIds(response)` | Extract acknowledged IDs from response |
| `extractEntitiesFromChanges(changes)` | Extract entities from changes array |
| `extractEntitiesFromSnapshot(response)` | Extract entities from snapshot |

## Error Classes

| Export | Extends | Description |
|---|---|---|
| `OfflineSyncError` | `Error` | Base error for all core errors |
| `ConflictResolutionError` | `OfflineSyncError` | Unresolvable conflict |
| `SyncConnectionError` | `OfflineSyncError` | Connection failure during sync |
| `SyncProtocolError` | `OfflineSyncError` | Protocol-level error |
