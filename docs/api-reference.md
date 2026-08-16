# API Reference

Complete public API listing organized by package.

---

## @offlinesync/storage

Pure TypeScript — zero runtime dependencies. Defines the storage contract.

### Types

| Export | Kind | Description |
|---|---|---|
| `Entity<T>` | type | Core data structure: `id`, `data: T`, `revision`, `createdAt`, `updatedAt`, `isDeleted` |
| `Cursor` | type | Opaque string cursor for incremental sync pagination |
| `StorageAdapter` | type (interface) | `get<T>`, `put<T>`, `delete`, `query<T>`, `transaction<T>`, `close` |
| `Transaction` | type (interface) | `get<T>`, `put<T>`, `delete`, `query<T>`, `commit`, `rollback` |
| `Query<T>` | type (interface) | `toDefinition()`, `clone()` |
| `QueryDefinition` | type | Serialized query: `filters`, `sort`, `offset`, `limit` |
| `QueryFilter` | type | `{ field, operator, value }` |
| `QuerySort` | type | `{ field, direction: SortDirection }` |
| `QueryOperator` | type | Union of operator string literals |
| `SortDirection` | type | `'asc' \| 'desc'` |

### Query Builder

| Export | Kind | Description |
|---|---|---|
| `QueryBuilder` | class | Fluent builder: `.filter(field, op, value)`, `.sort(field, dir)`, `.offset(n)`, `.limit(n)`, `.build()` |
| `createQuery<T>()` | function | Creates a new `QueryBuilder<T>` instance |

### Constants

| Export | Description |
|---|---|
| `QUERY_OPERATOR` | `{ EQ, NEQ, GT, GTE, LT, LTE, IN, CONTAINS }` — valid filter operators |

### Errors

| Export | Extends | Description |
|---|---|---|
| `StorageError` | `Error` | Base storage error with `code` and `collection` properties |
| `NotFoundError` | `StorageError` | Entity not found (`code: 'NOT_FOUND'`) |
| `TransactionError` | `StorageError` | Transaction violation (`code: 'TRANSACTION_ERROR'`) |
| `QueryError` | `StorageError` | Query execution failure (`code: 'QUERY_ERROR'`) |
| `ConstraintError` | `StorageError` | Constraint violation (`code: 'CONSTRAINT_ERROR'`) |

---

## @offlinesync/protocol

Fully independent wire protocol types. No dependencies on other OfflineSync packages.

### Incremental Sync Types

| Export | Kind | Description |
|---|---|---|
| `SyncRequest` | type | Client → server: `clientId`, `mutations`, `cursor` |
| `SyncResponse` | type | Server → client: `changes`, `conflicts`, `acknowledgedMutationIds`, `serverCursor`, `errors` |
| `Change` | type | A single remote change: `entity`, `type` |
| `ConflictInfo` | type | Conflict detail: `entityId`, `collectionName`, `clientVersion`, `serverVersion` |
| `ProtocolEntity` | type | Wire format entity: `id`, `data`, `revision`, `createdAt`, `updatedAt`, `isDeleted` |
| `ProtocolMutation` | type | Wire format mutation: `id`, `entityId`, `collectionName`, `operation`, `field`, `value`, `sequence`, `createdAt` |

### Snapshot Sync Types

| Export | Kind | Description |
|---|---|---|
| `SnapshotRequest` | type | Full-state request: `clientId`, `collections` |
| `SnapshotResponse` | type | Full-state response: `entitiesByCollection`, `serverCursor` |

### Error Types

| Export | Kind | Description |
|---|---|---|
| `ProtocolError` | type | `{ code: SyncErrorCode, message, classification?, retryAfter? }` |
| `SyncErrorCode` | type | Union of error code string literals |
| `ErrorClassification` | type | `'RETRYABLE' \| 'AUTHENTICATION' \| 'PERMANENT' \| 'UNKNOWN'` |

### Handshake

| Export | Kind | Description |
|---|---|---|
| `CURRENT_PROTOCOL_VERSION` | const | Current supported protocol version string |
| `ProtocolVersion` | type | Parsed version: `major`, `minor`, `patch` |
| `negotiateVersion(client, server)` | function | Returns the highest mutually supported version |
| `parseVersion(v)` | function | Parses a version string into `ProtocolVersion` |

### Validation (Type Guards)

| Export | Description |
|---|---|
| `isProtocolEntity(v)` | Runtime check for `ProtocolEntity` |
| `isProtocolMutation(v)` | Runtime check for `ProtocolMutation` |
| `isChange(v)` | Runtime check for `Change` |
| `isConflictInfo(v)` | Runtime check for `ConflictInfo` |
| `isSyncRequest(v)` | Runtime check for `SyncRequest` |
| `isSyncResponse(v)` | Runtime check for `SyncResponse` |
| `isSnapshotRequest(v)` | Runtime check for `SnapshotRequest` |
| `isSnapshotResponse(v)` | Runtime check for `SnapshotResponse` |
| `isProtocolError(v)` | Runtime check for `ProtocolError` |
| `isSyncErrorCode(v)` | Runtime check for valid error code |
| `isErrorClassification(v)` | Runtime check for valid classification |

### Constants

| Export | Description |
|---|---|
| `SYNC_ERROR_CODE` | All valid protocol error codes |
| `ERROR_CLASSIFICATION` | Error classification values |
| `ERROR_CODE_CLASSIFICATION` | Maps error codes to classifications |
| `CLASSIFICATION_RETRY_BEHAVIOR` | Maps classifications to `{ shouldRetry }` |

---

## @offlinesync/conflict

### Types

| Export | Kind | Description |
|---|---|---|
| `ConflictContext` | type | `{ entityId, collectionName, clientVersion, serverVersion, clientData, serverData, operation }` |
| `ConflictResolution` | type | `{ outcome: ResolutionOutcome, data?: unknown }` |
| `ResolutionOutcome` | type | `'resolved' \| 'client-wins' \| 'server-wins' \| 'manual'` |
| `ConflictResolver` | type (interface) | `(context: ConflictContext) => Promise<ConflictResolution>` |
| `BuiltInStrategyName` | type | Union of built-in strategy name literals |
| `StrategyConfig` | type | `{ strategy: BuiltInStrategyName \| ConflictResolver }` |
| `ConflictResolutionManagerOptions` | type | `{ defaultStrategy, strategies, onConflict? }` |
| `OperationAwareConfig` | type | Config for `OperationAwareStrategy` |
| `ConflictResolveFunction` | type | `(context: ConflictContext) => Promise<ConflictResolution>` |

### Strategies

| Export | Description |
|---|---|
| `ServerWinsStrategy` | Always returns `server-wins` with server data |
| `ClientWinsStrategy` | Always returns `client-wins` with client data |
| `LastWriteWinsStrategy` | Compares `updatedAt` timestamps, picks the newer one |
| `FieldMergeStrategy` | Merges individual fields; server wins on conflicts |
| `OperationAwareStrategy` | Uses operation type (set/field) for smarter resolution |
| `ManualStrategy` | Returns `manual` outcome for application-level handling |
| `FunctionStrategy` | Wraps a user-provided `ConflictResolveFunction` |

### Manager

| Export | Kind | Description |
|---|---|---|
| `ConflictResolutionManager` | class | Routes conflicts to per-collection strategies. Methods: `resolve(collectionName, context)`, `registerStrategy(name, strategy)` |
| `BUILT_IN_STRATEGY` | const | `{ SERVER_WINS, CLIENT_WINS, LAST_WRITE_WINS, FIELD_MERGE, OPERATION_AWARE, MANUAL }` |

---

## @offlinesync/core

The primary developer-facing package. Re-exports key types from `@offlinesync/storage`, `@offlinesync/conflict`, and `@offlinesync/protocol`.

### Types

| Export | Kind | Description |
|---|---|---|
| `OperationType` | type | `'set' \| 'update' \| 'delete'` |
| `Mutation` | type | `{ id, entityId, collectionName, operation, field, value, sequence, status, createdAt, retries, lastError }` |
| `MutationStatus` | type | `'pending' \| 'in-flight' \| 'acknowledged' \| 'failed' \| 'conflict'` |
| `SyncState` | type | `'local-only' \| 'syncing' \| 'synced' \| 'error'` |
| `ErrorClassification` | type | Client-side error classification |
| `IdGenerator` | type (interface) | `{ generate(): string }` — UUIDv7 generator |

### Constants

| Export | Description |
|---|---|
| `OPERATION_TYPE` | `{ SET, UPDATE, DELETE }` |
| `MUTATION_STATUS` | `{ PENDING, IN_FLIGHT, ACKNOWLEDGED, FAILED, CONFLICT }` |
| `SYNC_STATE` | `{ LOCAL_ONLY, SYNCING, SYNCED, ERROR }` |
| `ERROR_CLASSIFICATION` | Client-side error classification values |

### Collection

#### `Collection<T>`

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
| `getSyncState()` | `SyncState` | Current sync state of this collection |
| `setSyncState(state)` | `void` | Update sync state |

#### Collection Events

| Export | Description |
|---|---|
| `COLLECTION_CHANGE_TYPE` | `{ CREATE, UPDATE, DELETE, PURGE }` |
| `CollectionChangeEvent<T>` | `{ type, collectionName, entity }` |
| `CollectionChangeCallback<T>` | `(event: CollectionChangeEvent<T>) => void` |
| `CollectionSubscription` | `{ dispose(): void }` |
| `CollectionOptions` | `{ mutationRecorder?, mutationQueue? }` |

### MutationRecorder

#### `new MutationRecorder(options: MutationRecorderOptions)`

| Method | Returns | Description |
|---|---|---|
| `recordSet(collectionName, entity)` | `Mutation` | Record a full entity replacement |
| `recordUpdate(collectionName, entityId, changes)` | `Mutation` | Record a partial field update |
| `recordDelete(collectionName, entityId)` | `Mutation` | Record a deletion |
| `initializeSequence(collectionName, maxSequence)` | `void` | Initialize sequence tracker from stored state |

### MutationQueue

#### `new MutationQueue(options: MutationQueueOptions)`

| Method | Returns | Description |
|---|---|---|
| `enqueue(mutation, tx?)` | `Promise<void>` | Add mutation (optionally within a transaction) |
| `dequeuePending(limit)` | `Promise<Mutation[]>` | Get pending mutations in sequence order |
| `acknowledge(mutationId)` | `Promise<void>` | Mark as acknowledged |
| `markInFlight(mutationId)` | `Promise<void>` | Mark as in-flight |
| `markFailed(mutationId, error)` | `Promise<void>` | Mark as failed |
| `markConflict(mutationId, error?)` | `Promise<void>` | Mark as conflicted |
| `retry(mutationId)` | `Promise<void>` | Retry a failed mutation |
| `resolveConflict(mutationId, updates?)` | `Promise<void>` | Resolve a conflict and re-queue |
| `pendingCount()` | `Promise<number>` | Count non-terminal mutations |
| `getMutationsForEntity(collectionName, entityId)` | `Promise<Mutation[]>` | Get all mutations for an entity |
| `getMaxSequence(collectionName)` | `Promise<number>` | Get max sequence number for a collection |

### SyncEngine

#### `new SyncEngine(options: SyncEngineOptions)`

| Option | Type | Description |
|---|---|---|
| `clientId` | `string` | Unique client identifier |
| `storage` | `StorageAdapter` | Storage for entities and cursor |
| `mutationQueue` | `MutationQueue` | Durable mutation queue |
| `transport` | `SyncTransport` | Server communication transport |
| `conflictResolver` | `ConflictResolutionManager` | Conflict resolution routing |
| `batchSize` | `number` | Max mutations per sync cycle (default: 50) |

| Method | Returns | Description |
|---|---|---|
| `sync()` | `Promise<SyncCycleResult>` | Run a single sync cycle |
| `snapshotSync(collections)` | `Promise<void>` | Full-state snapshot sync |

#### `SyncCycleResult`

| Field | Type | Description |
|---|---|---|
| `acknowledgedMutations` | `number` | Mutations confirmed by server |
| `appliedChanges` | `number` | Remote changes applied locally |
| `conflicts` | `ConflictEvent[]` | Unresolved conflicts |
| `errors` | `Array<{ code, message }>` | Non-fatal errors during sync |

### SyncScheduler

#### `new SyncScheduler(options: SyncSchedulerOptions)`

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `SyncEngine` | — | The sync engine |
| `connectivityDetector` | `ConnectivityDetector` | — | Optional connectivity listener |
| `baseIntervalMs` | `number` | `30_000` | Base sync interval |
| `backoffMultiplier` | `number` | `2` | Exponential backoff multiplier |
| `maxBackoffMs` | `number` | `300_000` | Maximum backoff cap |
| `onSyncComplete` | `(result, error) => void` | — | Post-cycle callback |

| Method | Returns | Description |
|---|---|---|
| `start()` | `void` | Begin periodic sync |
| `stop()` | `void` | Stop periodic sync |
| `triggerSync()` | `void` | Trigger immediate sync |
| `dispose()` | `void` | Release all resources |
| `currentInterval` | `number` (get) | Current interval between cycles |
| `isSyncing` | `boolean` (get) | Whether a cycle is in progress |

### SyncTransport (interface)

| Export | Kind | Description |
|---|---|---|
| `SyncTransport` | type (interface) | `getVersionInfo()`, `sendSync(request)`, `sendSnapshot(request)` |
| `VersionInfo` | type | `{ protocolVersion }` |
| `StubSyncTransport` | class | In-memory transport for testing |

### MutationSender

| Export | Kind | Description |
|---|---|---|
| `MutationSender` | class | Sends mutations via `MutationTransport` with retry logic |
| `MutationTransport` | type (interface) | `sendMutations(mutations)` |
| `StubMutationTransport` | class | In-memory transport for testing |
| `SendResult` | type | `{ sent: Mutation[], failed: Mutation[] }` |
| `SendAttempt` | type | Single mutation send attempt result |
| `RetryConfig` | type | `{ maxRetries, baseDelayMs }` |

### RecoveryManager

#### `new RecoveryManager(options: RecoveryManagerOptions)`

| Method | Returns | Description |
|---|---|---|
| `recover()` | `Promise<RecoveryResult>` | Detect and recover from interrupted sync cycles |

#### `RecoveryResult`

| Field | Type | Description |
|---|---|---|
| `repaired` | `boolean` | Whether repairs were made |
| `actions` | `RepairAction[]` | List of repair actions taken |
| `warnings` | `RecoveryWarning[]` | Non-critical warnings |

### IntegrityChecker

#### `new IntegrityChecker(options: IntegrityCheckerOptions)`

| Method | Returns | Description |
|---|---|---|
| `check()` | `Promise<IntegrityCheckResult>` | Validate data consistency across all collections |
| `repair()` | `Promise<IntegrityCheckResult>` | Check and repair issues |

#### `IntegrityCheckResult`

| Field | Type | Description |
|---|---|---|
| `issues` | `IntegrityIssue[]` | Detected integrity issues |
| `repaired` | `number` | Number of issues repaired |
| `summary` | `IntegritySummary` | Counts by severity |

### LifecycleManager

#### `new LifecycleManager(options: LifecycleManagerOptions)`

| Method | Returns | Description |
|---|---|---|
| `shutdown()` | `Promise<ShutdownResult>` | Graceful shutdown ensuring in-flight operations complete |

### Error Classifier

| Export | Kind | Description |
|---|---|---|
| `ErrorClassifier` | class | Classifies errors by type for retry/backoff decisions |
| `ClassifiedError` | type | `{ error, classification, retryable, transportError? }` |

### Error Classes

| Export | Extends | Description |
|---|---|---|
| `OfflineSyncError` | `Error` | Base error for all core errors |
| `ConflictResolutionError` | `OfflineSyncError` | Unresolvable conflict |
| `SyncConnectionError` | `OfflineSyncError` | Connection failure during sync |
| `SyncProtocolError` | `OfflineSyncError` | Protocol-level error |
| `SyncTransportError` | `Error` | Transport-level error (from `@offlinesync/transport-http`) |

### Type Converters

| Export | Description |
|---|---|
| `clientMutationToProtocol(mutation)` | Convert client `Mutation` to `ProtocolMutation` |
| `buildSyncRequest(clientId, mutations, cursor)` | Build a `SyncRequest` from client state |
| `protocolEntityToClient(entity)` | Convert `ProtocolEntity` to client `Entity` |
| `extractAcknowledgedIds(response)` | Extract acknowledged mutation IDs from response |
| `extractConflictIds(response)` | Extract conflicting entity IDs from response |
| `extractEntitiesFromChanges(changes)` | Extract entities from an array of `Change` |
| `extractEntitiesFromSnapshot(response)` | Extract all entities from a `SnapshotResponse` |

---

## @offlinesync/server

Reference in-memory sync server for testing and development.

| Export | Kind | Description |
|---|---|---|
| `SyncServer` | class | Handles `sync()` and `snapshot()` requests. Methods: `sync(request)`, `snapshot(request)`, `getStats()` |
| `ServerChangeLog` | class | Tracks server-side changes per client cursor |
| `ChangeLogEntry` | type | `{ entity, type, timestamp, collectionName }` |
| `ServerMutationTracker` | class | Records mutations received from clients |

---

## @offlinesync/transport-http

| Export | Kind | Description |
|---|---|---|
| `HttpSyncTransport` | class | HTTP transport using global `fetch` API |
| `SyncTransportError` | class | Transport error with `code` property mapped to protocol error codes |
| `HttpTransportOptions` | type | `{ syncEndpoint, snapshotEndpoint?, clientId, headers?, fetchFn? }` |

---

## @offlinesync/transport-websocket

| Export | Kind | Description |
|---|---|---|
| `WebSocketSyncTransport` | class | Bidirectional WebSocket transport with push support |
| `WebSocketTransportOptions` | type | `{ url, clientId?, reconnect?, WebSocketFactory? }` |
| `WS_CONNECTION_STATE` | const | `{ CONNECTING, CONNECTED, DISCONNECTING, DISCONNECTED, RECONNECTING }` |
| `WS_MSG_TYPE` | const | All WebSocket message type constants |

### WebSocket Message Types

| Export | Kind | Description |
|---|---|---|
| `WsClientMessage` | type | Union of client → server message types |
| `WsServerMessage` | type | Union of server → client message types |
| `WsVersionNegotiateMsg` | type | Version negotiation message |
| `WsSyncRequestMsg` | type | Sync request message |
| `WsSnapshotRequestMsg` | type | Snapshot request message |
| `WsPingMsg` | type | Keepalive ping |
| `WsVersionResponseMsg` | type | Version negotiation response |
| `WsSyncResponseMsg` | type | Sync response message |
| `WsSnapshotResponseMsg` | type | Snapshot response message |
| `WsPongMsg` | type | Keepalive pong |
| `WsPushChangesMsg` | type | Server-pushed changes |
| `WsErrorMsg` | type | Error message |
| `isWsServerMessage(v)` | function | Type guard for server messages |
| `OnConnectionStateChange` | type | `(state: WsConnectionState) => void` |
| `OnPushChanges` | type | `(changes, cursor) => void` |
| `MinimalWebSocket` | type | Subset of WebSocket interface |
| `WebSocketFactory` | type | `(url) => MinimalWebSocket` |

---

## @offlinesync/storage-sqlite

| Export | Kind | Description |
|---|---|---|
| `SQLiteStorageAdapter` | class | SQLite implementation using better-sqlite3 |
| `SQLiteAdapterOptions` | type | `{ dbPath }` |

---

## @offlinesync/discovery

| Export | Kind | Description |
|---|---|---|
| `DiscoveryService` | class | Pluggable peer discovery with `start()`, `stop()`, `discover()`, `onPeerDiscovered()`, `onPeerLost()` |
| `DISCOVERY_STATE` | const | `{ STOPPED, STARTING, ACTIVE, STOPPING }` |
| `InMemoryDiscoveryBackend` | class | In-memory backend for testing |
| `DiscoveryError` | class | Discovery-specific errors |
| `PeerInfo` | type | `{ id, endpoint, metadata? }` |
| `DiscoveryBackend` | type (interface) | `start()`, `stop()`, `onPeerFound?`, `onPeerLost?` |
| `OnPeerFound` | type | `(peer: PeerInfo) => void` |
| `OnPeerLost` | type | `(peer: PeerInfo) => void` |
| `OnPeerDiscovered` | type | `(peer: PeerInfo) => void` |
| `OnPeerLostCallback` | type | `(peer: PeerInfo) => void` |
| `DiscoveryState` | type | Union of `DISCOVERY_STATE` values |

---

## @offlinesync/react

Peer dependency: `react >= 17.0.0`

### Context & Provider

| Export | Kind | Description |
|---|---|---|
| `OfflineSyncContext` | React context | The OfflineSync context object |
| `OfflineSyncProvider` | component | Context provider wrapping `engine`, `storage`, `mutationRecorder`, `mutationQueue` |
| `useOfflineSyncContext()` | hook | Access the raw context value |

### Hooks

| Export | Kind | Description |
|---|---|---|
| `useOfflineSync(config?)` | hook | One-hook setup returning `{ useCollection, useEntity, useSyncState, engine }` |
| `useCollection(name, options?)` | hook | Returns `{ entities, loading, error, syncState }` for a collection |
| `useEntity(collectionName, id)` | hook | Returns `{ entity, loading, error }` for a single entity |
| `useSyncState(source?)` | hook | Returns `{ syncState, pendingMutations, lastSyncAt }` |

### Hook Types

| Export | Description |
|---|---|
| `UseOfflineSyncConfig` | Configuration for `useOfflineSync` |
| `UseOfflineSyncResult` | Return type of `useOfflineSync` |
| `UseCollectionResult<T>` | `{ entities, loading, error, syncState }` |
| `UseEntityResult<T>` | `{ entity, loading, error }` |
| `CollectionHookOptions` | Options for `useCollection` |
| `OfflineSyncContextValue` | Shape of the context value |
| `OfflineSyncProviderProps` | Provider component props |
| `CollectionDataSource` | Data source interface for collections |
| `EntityDataSource` | Data source interface for entities |
| `SyncStateSource` | Data source interface for sync state |

### Logic Layer (Advanced)

| Export | Description |
|---|---|
| `createCollectionController(options)` | Create a collection state controller |
| `createEntityController(options)` | Create an entity state controller |
| `createSyncStateController(source)` | Create a sync state controller |
| `createInitialCollectionState()` | Default collection state |
| `createInitialEntityState()` | Default entity state |
| `getDefaultSyncState()` | Default sync state |
| `createEngineSyncStateSource(engine)` | Create sync state source from a SyncEngine |
| `getDefaultSyncStateResult()` | Default sync state hook result |
| Event handler functions | `handleCollectionEntitiesLoaded`, `handleCollectionError`, `handleCollectionSyncStateChange`, `handleEntityLoaded`, `handleEntityNotFound`, `handleEntityError`, `handleSyncStateChange` |

---

## @offlinesync/vue

Peer dependency: `vue >= 3.0.0`

### Injection & Context

| Export | Kind | Description |
|---|---|---|
| `OFFLINE_SYNC_KEY` | Injection key | Vue injection key string |
| `provideOfflineSync(value)` | function | Provide the OfflineSync context to descendants |
| `useOfflineSyncContext()` | composable | Access the injected context value |

### Composables

| Export | Kind | Description |
|---|---|---|
| `useOfflineSync(config?)` | composable | One-composable setup returning `{ useCollection, useEntity, useSyncState, engine }` |
| `useCollection(name, options?)` | composable | Returns `{ entities, loading, error, syncState }` for a collection |
| `useEntity(collectionName, id)` | composable | Returns `{ entity, loading, error }` for a single entity |
| `useSyncState(source?)` | composable | Returns `{ syncState, pendingMutations, lastSyncAt }` |

### Composable Types

| Export | Description |
|---|---|
| `UseOfflineSyncConfig` | Configuration for `useOfflineSync` |
| `UseOfflineSyncResult` | Return type of `useOfflineSync` |
| `UseCollectionResult<T>` | `{ entities, loading, error, syncState }` |
| `UseEntityResult<T>` | `{ entity, loading, error }` |
| `CollectionComposableOptions` | Options for `useCollection` |
| `OfflineSyncInjectionValue` | Shape of the injected value |
| `CollectionDataSource` | Data source interface for collections |
| `EntityDataSource` | Data source interface for entities |
| `SyncStateSource` | Data source interface for sync state |

### Logic Layer (Advanced)

Same logic layer functions as `@offlinesync/react` — see above.

---

## @offlinesync/electron

Peer dependency: `electron >= 22.0.0`

### Main Process

| Export | Kind | Description |
|---|---|---|
| `createIPCHandler(registration)` | function | Register IPC handlers on main process |
| `IpcHandlerRegistration` | type | `{ ipcMain, engine, storage, mutationRecorder, mutationQueue }` |

### Renderer Process

| Export | Kind | Description |
|---|---|---|
| `createRendererSyncClient(ipcRenderer)` | function | Create a sync client for the renderer process |
| `RendererSyncClient` | type (interface) | `{ sync(), getCollection(name), putEntity(collection, entity), getEntity(collection, id), getSyncState() }` |
| `RendererSyncResult` | type | Result from renderer sync call |

### IPC Bridge

| Export | Kind | Description |
|---|---|---|
| `ElectronSyncBridge` | class | Low-level IPC serialization utilities |
| `IpcBridgeError` | class | IPC-specific errors |
| `serializeForIpc(data)` | function | Serialize data for IPC transfer |
| `createIpcRequest(method, params)` | function | Create an IPC request envelope |
| `createIpcSuccessResponse(id, result)` | function | Create an IPC success response |
| `createIpcErrorResponse(id, error)` | function | Create an IPC error response |
| `deserializeSyncState(data)` | function | Deserialize sync state from IPC |
| `deserializeSyncCycleResult(data)` | function | Deserialize sync result from IPC |
| `generateRequestId()` | function | Generate a unique IPC request ID |
| `resetRequestIdCounter()` | function | Reset the request ID counter (for testing) |

### IPC Types

| Export | Description |
|---|---|
| `IPC_CHANNEL` | `{ SYNC, GET_COLLECTION, PUT_ENTITY, GET_ENTITY, GET_SYNC_STATE }` — IPC channel names |
| `IpcChannel` | Union of channel name literals |
| `IpcRequest` | `{ id, method, params }` |
| `IpcResponse` | `{ id, success, result?, error? }` |
| `SerializedSyncState` | Serialized sync state for IPC |
| `SerializedSyncCycleResult` | Serialized sync result for IPC |
| `IpcMainLike` | Interface matching Electron's `ipcMain` |
| `IpcRendererLike` | Interface matching Electron's `ipcRenderer` |
| `IpcHandlerFunction` | `(event, request) => Promise<unknown>` |
| `RegisteredHandler` | `{ channel, handler, remove }` |
