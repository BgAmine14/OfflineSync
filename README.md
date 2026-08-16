# OfflineSync

Local-first synchronization engine for applications that need to work
with unreliable or intermittent connectivity.

## Architecture

OfflineSync is a monorepo of 12 packages organized into four layers:
protocol, storage, core engine, and platform integrations.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Platform Integrations                          │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────────────────┐ │
│  │  React   │  │   Vue    │  │  Electron  │  │      Discovery       │ │
│  │  hooks   │  │composables│  │  IPC bridge │  │  (LAN peer sync)    │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └───────────┬───────────┘ │
└───────┼──────────────┼──────────────┼─────────────────────┼─────────────┘
        │              │              │                     │
┌───────┴──────────────┴──────────────┴─────────────────────┴─────────────┐
│                          Core Engine                                   │
│                                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │
│  │ SyncEngine    │  │ Collection   │  │ ConflictResolutionManager  │   │
│  │               │  │ (typed CRUD) │  │ (per-collection routing)   │   │
│  └───────┬───────┘  └──────┬───────┘  └────────────┬───────────────┘   │
│          │                 │                       │                     │
│  ┌───────┴─────────────────┴───────────────────────┴───────────────┐   │
│  │ MutationQueue  │  MutationRecorder  │  SyncScheduler            │   │
│  │ (durable)      │  (seq tracking)   │  (backoff scheduling)      │   │
│  └────────────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ RecoveryManager  │  IntegrityChecker  │  LifecycleManager       │   │
│  │ (crash recovery) │ (data integrity)   │ (graceful shutdown)      │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬───────────────────────────────────────────┘
                            │
┌───────────────────────────┴───────────────────────────────────────────┐
│                       Transport Layer                                 │
│                                                                         │
│  ┌────────────────────┐      ┌────────────────────────────────────┐   │
│  │ transport-http     │      │ transport-websocket                 │   │
│  │ (request/response) │      │ (bidirectional, server push)        │   │
│  └─────────┬──────────┘      └──────────────┬─────────────────────┘   │
└────────────┼─────────────────────────────────┼─────────────────────────┘
             │                                 │
┌────────────┴─────────────────────────────────┴─────────────────────────┐
│                     Protocol & Storage                                 │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │   protocol   │  │   storage    │  │storage-sqlite│                 │
│  │ (wire types) │  │ (interface)  │  │ (SQLite impl)│                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│  ┌──────────────┐  ┌──────────────┐                                  │
│  │   conflict   │  │   server     │                                  │
│  │ (strategies) │  │ (ref server) │                                  │
│  └──────────────┘  └──────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Local-first** — All data is stored locally first; reads never block on the network.
- **Offline mutations** — Writes are queued and replayed when connectivity returns.
- **Incremental sync** — Only changed data is transmitted using cursor-based pagination.
- **Conflict resolution** — Six built-in strategies with per-collection routing.
- **Snapshot sync** — Full state sync for initial setup and cursor-too-old recovery.
- **Realtime push** — Server push via WebSocket transport.
- **Crash safety** — Atomic transactions and durable mutation queue protect data integrity.
- **Integrity checking** — Detects and repairs data inconsistencies after crashes.
- **Recovery** — Automatic startup recovery for interrupted sync cycles.
- **Exponential backoff** — Smart retry scheduling with error classification.
- **LAN sync** — Pluggable peer discovery for local network synchronization.
- **Framework integrations** — First-class React hooks, Vue composables, and Electron IPC bridge.

## Quick Start

```typescript
import { Collection, MutationRecorder, MutationQueue, SyncEngine, SyncScheduler } from '@offlinesync/core';
import { SQLiteStorageAdapter } from '@offlinesync/storage-sqlite';
import { HttpSyncTransport } from '@offlinesync/transport-http';
import { ConflictResolutionManager, LastWriteWinsStrategy } from '@offlinesync/conflict';

// 1. Create a storage adapter
const storage = new SQLiteStorageAdapter({ dbPath: './myapp.db' });

// 2. Set up mutation tracking
const recorder = new MutationRecorder({ idGenerator: { generate: () => crypto.randomUUID() } });
const queue = new MutationQueue({ storage });

// 3. Create a typed collection
const tasks = new Collection<{ title: string; done: boolean }>('tasks', storage, {
  mutationRecorder: recorder,
  mutationQueue: queue,
});

// 4. Write data locally (works offline)
await tasks.create('task-1', { title: 'Build offline sync', done: false });

// 5. Configure sync
const transport = new HttpSyncTransport({
  syncEndpoint: 'https://api.example.com/sync',
  clientId: 'client-abc',
});

const conflictManager = new ConflictResolutionManager({
  defaultStrategy: 'last-write-wins',
  strategies: { 'last-write-wins': new LastWriteWinsStrategy() },
});

const engine = new SyncEngine({
  clientId: 'client-abc',
  storage,
  mutationQueue: queue,
  transport,
  conflictResolver: conflictManager,
});

// 6. Start syncing
const scheduler = new SyncScheduler({ engine });
scheduler.start();
```

For a detailed walkthrough, see [Getting Started](./docs/getting-started.md).

## Packages

| Package | Description | Dependencies |
|---|---|---|
| `@offlinesync/core` | Client sync engine, collections, mutations, scheduler, recovery, integrity | `storage`, `protocol`, `conflict`, `transport-http` |
| `@offlinesync/storage` | `StorageAdapter` interface, `Entity`/`Cursor` types, query builder, error classes | None (pure contracts) |
| `@offlinesync/protocol` | Wire protocol types, validation, version negotiation, error classification | None (fully independent) |
| `@offlinesync/conflict` | Conflict resolver interface and six built-in resolution strategies | None |
| `@offlinesync/server` | In-memory reference sync server for testing and development | `protocol` |
| `@offlinesync/transport-http` | HTTP transport using the global `fetch` API | `protocol`, `storage` (types only) |
| `@offlinesync/transport-websocket` | WebSocket transport with server push and version negotiation | `protocol` |
| `@offlinesync/storage-sqlite` | SQLite implementation of `StorageAdapter` using better-sqlite3 | `storage` |
| `@offlinesync/discovery` | Pluggable LAN peer discovery service | None |
| `@offlinesync/react` | React hooks (`useCollection`, `useEntity`, `useSyncState`, `useOfflineSync`) | `core`, `react` (peer) |
| `@offlinesync/vue` | Vue composables (`useCollection`, `useEntity`, `useSyncState`, `useOfflineSync`) | `core`, `vue` (peer) |
| `@offlinesync/electron` | Electron IPC bridge for main/renderer process sync | None |

## Setup

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0

### Install

```bash
git clone <repo-url>
cd offlinesync
pnpm install
```

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Lint

```bash
pnpm lint
```

### Typecheck

```bash
pnpm typecheck
```

### Run all checks

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

## API Overview

### `@offlinesync/core`

The primary developer-facing package. Provides:

- **`Collection<T>`** — Typed CRUD operations, querying, and change observation for a named entity collection.
- **`MutationRecorder`** — Creates mutation records for local writes with monotonically increasing sequence numbers.
- **`MutationQueue`** — Durable, ordered queue of pending mutations persisted via the StorageAdapter.
- **`SyncEngine`** — Orchestrates sync cycles: picks up pending mutations, sends via transport, applies remote changes, handles conflicts.
- **`SyncScheduler`** — Automatic periodic synchronization with exponential backoff and connectivity-aware triggering.
- **`ConflictResolutionManager`** — Per-collection conflict strategy routing (re-exported from `@offlinesync/conflict`).
- **`RecoveryManager`** — Detects and recovers from interrupted sync cycles on startup.
- **`IntegrityChecker`** — Validates data consistency and repairs common corruption patterns.
- **`LifecycleManager`** — Graceful shutdown ensuring in-flight operations complete.
- **`MutationSender`** — Sends mutations via a `MutationTransport` with retry logic and error classification.

### `@offlinesync/storage`

Zero-dependency package defining the storage contract:

- **`StorageAdapter`** — Interface for `get`, `put`, `delete`, `query`, `transaction`, `close`.
- **`Entity<T>`** — Core data structure with `id`, `data`, `revision`, `createdAt`, `updatedAt`, `isDeleted`.
- **`Cursor`** — Opaque cursor string for incremental sync pagination.
- **`QueryBuilder` / `createQuery<T>()`** — Fluent query builder with filter, sort, offset, limit.
- **`Transaction`** — Atomic read-write transaction interface.
- Error classes: `StorageError`, `NotFoundError`, `TransactionError`, `QueryError`, `ConstraintError`.

### `@offlinesync/protocol`

Fully independent wire protocol types:

- **`SyncRequest` / `SyncResponse`** — Incremental sync message types.
- **`SnapshotRequest` / `SnapshotResponse`** — Full-state sync message types.
- **`ProtocolMutation` / `ProtocolEntity` / `Change` / `ConflictInfo`** — Core protocol data structures.
- **`ProtocolError`** — Standardized error response with code, classification, and retry behavior.
- **`negotiateVersion()`** — Protocol version negotiation.
- **Type guards** — Runtime validation functions (`isSyncResponse`, `isProtocolEntity`, etc.).

### `@offlinesync/conflict`

Conflict resolution framework:

- **`ConflictResolutionManager`** — Routes conflicts to per-collection strategies.
- Built-in strategies: `ServerWinsStrategy`, `ClientWinsStrategy`, `LastWriteWinsStrategy`, `FieldMergeStrategy`, `OperationAwareStrategy`, `ManualStrategy`, `FunctionStrategy`.

### `@offlinesync/server`

Reference sync server implementation:

- **`SyncServer`** — In-memory server handling sync and snapshot requests.
- **`ServerChangeLog`** — Tracks server-side changes per client cursor.
- **`ServerMutationTracker`** — Records mutations received from clients.

### `@offlinesync/transport-http`

- **`HttpSyncTransport`** — HTTP transport using the global `fetch` API (Node 18+, Deno, Bun, browsers).
- **`SyncTransportError`** — Typed transport error with protocol error code mapping.

### `@offlinesync/transport-websocket`

- **`WebSocketSyncTransport`** — Bidirectional WebSocket transport with server push.
- Connection state management and version negotiation over WebSocket.
- **`onPush()`** — Callback for receiving server-pushed changes in realtime.

### `@offlinesync/storage-sqlite`

- **`SQLiteStorageAdapter`** — High-performance SQLite implementation using better-sqlite3.

### `@offlinesync/discovery`

- **`DiscoveryService`** — Pluggable LAN peer discovery.
- **`InMemoryDiscoveryBackend`** — In-memory backend for testing.
- **`DiscoveryBackend`** interface — Implement for custom discovery (mDNS, etc.).

### `@offlinesync/react`

- **`OfflineSyncProvider`** — React context provider.
- **`useOfflineSync(config?)`** — One-hook setup returning collection factory, sync state, and engine.
- **`useCollection(name)`** — Reactive collection data.
- **`useEntity(collectionName, id)`** — Reactive single entity.
- **`useSyncState()`** — Reactive sync state.

### `@offlinesync/vue`

- **`provideOfflineSync(value)`** — Vue provide/inject context.
- **`useOfflineSync(config?)`** — One-composable setup.
- **`useCollection(name)`** — Reactive collection data.
- **`useEntity(collectionName, id)`** — Reactive single entity.
- **`useSyncState()`** — Reactive sync state.

### `@offlinesync/electron`

- **`createIPCHandler(engine)`** — Main process IPC handler registration.
- **`createRendererSyncClient(ipcRenderer)`** — Renderer process sync client.
- **`ElectronSyncBridge`** — Serialization and IPC protocol utilities.

## Documentation

- [Getting Started](./docs/getting-started.md) — Installation, concepts, and a full working example.
- [API Reference](./docs/api-reference.md) — Complete public API listing organized by package.

## Project Status

**All phases complete.** OfflineSync has a fully functional client engine with
incremental and snapshot sync, conflict resolution, crash recovery, integrity
checking, HTTP and WebSocket transports, SQLite storage, LAN discovery, and
first-class React, Vue, and Electron integrations. The test suite contains 759+
tests covering unit, integration, property-based, stress, and benchmark scenarios.

## Invariants

The codebase is built around these invariants (referenced as INV-N in source):

| # | Invariant | Description |
|---|---|---|
| INV-1 | Sequence ordering | Mutations are strictly ordered by sequence number within each collection |
| INV-2 | Idempotency | Sync operations can be safely retried without side effects |
| INV-3 | Cursor consistency | Cursors are updated only after all changes are durable |
| INV-4 | Mutation durability | Pending mutations survive process restarts |
| INV-5 | Exactly-once processing | Each mutation is processed exactly once by the server |
| INV-6 | Conflict detection | Conflicts are detected when server and client versions diverge |
| INV-7 | Graceful degradation | The system remains functional under partial failures |
| INV-8 | Atomic writes | Entity updates and mutation records are stored in the same transaction |
| INV-9 | Backoff | Consecutive sync failures trigger exponential backoff |

## License

[MIT](./LICENSE) © OfflineSync Contributors
