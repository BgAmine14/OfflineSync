---
title: Getting Started
---

# Getting Started

This guide walks through setting up OfflineSync from scratch, covering installation, core concepts, and a complete working example.

## Installation

Install the packages you need for your platform:

```bash
# Core engine (required)
npm install @offlinesync/core

# Storage adapter (choose one)
npm install @offlinesync/storage-sqlite   # Node.js / Electron
# -- or implement your own StorageAdapter

# Transport (choose one or both)
npm install @offlinesync/transport-http       # Request/response sync
npm install @offlinesync/transport-websocket  # Bidirectional with push

# Conflict resolution (optional, included via @offlinesync/core re-exports)
npm install @offlinesync/conflict

# Framework integration (optional)
npm install @offlinesync/react    # React hooks
npm install @offlinesync/vue      # Vue composables
npm install @offlinesync/electron  # Electron IPC bridge

# LAN discovery (optional)
npm install @offlinesync/discovery
```

All packages are also available in the monorepo via `pnpm install` at the repository root.

## Core Concepts

### Entities

An **entity** is the fundamental unit of data. Every entity has:

```typescript
interface Entity<T> {
  id: string           // Unique identifier (application-provided or UUID)
  data: T              // Your domain-specific data
  revision: number     // Monotonically increasing version number
  createdAt: string    // ISO 8601 timestamp
  updatedAt: string    // ISO 8601 timestamp
  isDeleted: boolean   // Soft-delete flag
}
```

Entities are grouped into named **collections** (e.g., `'tasks'`, `'users'`, `'documents'`). Each collection is typed to a specific data shape.

### Collections

A `Collection<T>` provides typed CRUD operations and change observation:

- `get(id)` / `getOrNull(id)` — Read a single entity
- `create(id, data)` — Create a new entity (fails if exists)
- `put(entity)` — Create or replace an entity
- `update(id, changes)` — Partial update of specific fields
- `delete(id)` — Soft-delete an entity
- `query(query)` — Filter, sort, paginate entities
- `subscribe(callback)` — Observe real-time change events

### Mutations

Every local write to a `Collection` (when mutation tracking is enabled) produces a **mutation record**. Mutations are:

- Stored durably in the same transaction as the entity write (crash safe)
- Assigned monotonically increasing sequence numbers per collection
- Queued in a `MutationQueue` and sent to the server during sync

Mutation statuses: `PENDING` → `IN_FLIGHT` → `ACKNOWLEDGED` (or `FAILED` / `CONFLICT`)

### Synchronization

The `SyncEngine` orchestrates sync cycles:

1. Dequeues pending mutations from the `MutationQueue`
2. Sends them to the server via a `SyncTransport` (HTTP or WebSocket)
3. Receives remote changes and applies them to local storage
4. Handles conflicts by delegating to the `ConflictResolutionManager`
5. Updates the sync cursor only after all changes are durable

Two sync modes:
- **Incremental sync** — Sends mutations, receives changes since last cursor
- **Snapshot sync** — Full state transfer (used for initial sync or cursor recovery)

### Conflict Resolution

When the server and client have divergent changes for the same entity, a conflict occurs. The `ConflictResolutionManager` routes conflicts to per-collection strategies:

- `last-write-wins` — Compare `updatedAt` timestamps
- `server-wins` — Always accept the server version
- `client-wins` — Always keep the client version
- `field-merge` — Merge individual fields from both sides
- `operation-aware` — Consider the operation type (set vs. field update)
- `manual` — Return conflict info for application-level resolution

## Full Working Example

This example uses an in-memory storage adapter (for demonstration). In production, use `SQLiteStorageAdapter` from `@offlinesync/storage-sqlite`.

```typescript
import {
  Collection,
  MutationRecorder,
  MutationQueue,
  SyncEngine,
  SyncScheduler,
  createQuery,
  StubSyncTransport,
  ConflictResolutionManager,
  LastWriteWinsStrategy,
} from '@offlinesync/core'
import type { StorageAdapter, Entity } from '@offlinesync/core'

// 1. Storage Adapter (in-memory for demo)
const store = new Map<string, Map<string, Entity<unknown>>>()
const storage: StorageAdapter = {
  async get<T>(collection: string, id: string) {
    const entity = store.get(collection)?.get(id)
    if (!entity) throw new Error(`Not found: ${collection}/${id}`)
    return entity as Entity<T>
  },
  async put<T>(collection: string, entity: Entity<T>) {
    if (!store.has(collection)) store.set(collection, new Map())
    store.get(collection)!.set(entity.id, entity as Entity<unknown>)
  },
  async delete(collection: string, id: string) {
    store.get(collection)?.delete(id)
  },
  async query<T>(collection: string) {
    const entities = store.get(collection)
    return entities
      ? Array.from(entities.values()).filter((e) => !e.isDeleted) as Entity<T>[]
      : []
  },
  async transaction<T>(callback: (tx: any) => Promise<T>) {
    return callback(this)
  },
  async close() {
    store.clear()
  },
}

// 2. Mutation Tracking
const recorder = new MutationRecorder({
  idGenerator: { generate: () => crypto.randomUUID() },
})
const queue = new MutationQueue({ storage })

// 3. Create a Collection
type Task = { title: string; done: boolean; priority: number }
const tasks = new Collection<Task>('tasks', storage, {
  mutationRecorder: recorder,
  mutationQueue: queue,
})

// 4. Write Data (works offline!)
await tasks.create('task-1', { title: 'Learn OfflineSync', done: false, priority: 1 })
await tasks.update('task-1', { done: true })

// 5. Sync Configuration
const transport = new StubSyncTransport()
const conflictManager = new ConflictResolutionManager({
  defaultStrategy: 'last-write-wins',
  strategies: { 'last-write-wins': new LastWriteWinsStrategy() },
})
const engine = new SyncEngine({
  clientId: 'my-app-client',
  storage,
  mutationQueue: queue,
  transport,
  conflictResolver: conflictManager,
})

// 6. Start Syncing
const result = await engine.sync()
console.log(`Synced: ${result.appliedChanges} changes, ${result.acknowledgedMutations} acknowledged`)

// 7. Auto-sync with scheduling
const scheduler = new SyncScheduler({
  engine,
  baseIntervalMs: 30_000,
  onSyncComplete: (result, error) => {
    if (error) console.error('Sync failed:', error.message)
    else if (result) console.log('Sync complete')
  },
})
scheduler.start()
```

## Using with React

```tsx
import { OfflineSyncProvider, useOfflineSync } from '@offlinesync/react'

function App() {
  return (
    <OfflineSyncProvider engine={syncEngine} storage={storage} mutationRecorder={recorder} mutationQueue={queue}>
      <TaskList />
    </OfflineSyncProvider>
  )
}

function TaskList() {
  const { useCollection } = useOfflineSync()
  const { entities, loading, error } = useCollection('tasks')

  if (loading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>

  return (
    <ul>
      {entities.map((e) => (
        <li key={e.id}>{e.data.title}</li>
      ))}
    </ul>
  )
}
```

## Using with Vue

```vue
<script setup lang="ts">
import { provideOfflineSync, useOfflineSync } from '@offlinesync/vue'

provideOfflineSync({ engine, storage, mutationRecorder, mutationQueue })

const { useCollection } = useOfflineSync()
const { entities, loading, error } = useCollection('tasks')
</script>

<template>
  <ul v-if="!loading && !error">
    <li v-for="e in entities" :key="e.id">{{ e.data.title }}</li>
  </ul>
</template>
```

## Using with Electron

```typescript
// Main process
import { createIPCHandler } from '@offlinesync/electron'
createIPCHandler({ ipcMain, engine: syncEngine, storage, mutationRecorder, mutationQueue })

// Renderer process
import { createRendererSyncClient } from '@offlinesync/electron'
const client = createRendererSyncClient(ipcRenderer)
const result = await client.sync()
```