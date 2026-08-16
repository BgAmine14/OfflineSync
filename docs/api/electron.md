---
title: '@offlinesync/electron'
---

# @offlinesync/electron

Electron IPC bridge for main/renderer process sync. Peer dependency: `electron >= 22.0.0`.

## Main Process

Register IPC handlers in the main process:

```typescript
import { createIPCHandler } from '@offlinesync/electron'

createIPCHandler({
  ipcMain,
  engine: syncEngine,
  storage,
  mutationRecorder: recorder,
  mutationQueue: queue,
})
```

This registers handlers for these IPC channels:

| Channel | Description |
|---|---|
| `offlinesync:sync` | Trigger a sync cycle |
| `offlinesync:get-collection` | Get all entities in a collection |
| `offlinesync:put-entity` | Create or update an entity |
| `offlinesync:get-entity` | Get a single entity |
| `offlinesync:get-sync-state` | Get current sync state |

## Renderer Process

Create a sync client in the renderer:

```typescript
import { createRendererSyncClient } from '@offlinesync/electron'

const client = createRendererSyncClient(ipcRenderer)

// Trigger sync
const result = await client.sync()

// Get collection data
const tasks = await client.getCollection('tasks')

// Get single entity
const task = await client.getEntity('tasks', 'task-1')

// Write data
await client.putEntity('tasks', { id: 'task-1', data: { title: 'New task' }, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDeleted: false })

// Check sync state
const state = await client.getSyncState()
```

## RendererSyncClient

| Method | Returns | Description |
|---|---|---|
| `sync()` | `Promise<SyncCycleResult>` | Trigger a sync cycle |
| `getCollection(name)` | `Promise<Entity[]>` | Get all entities in a collection |
| `putEntity(collection, entity)` | `Promise<Entity>` | Create or update an entity |
| `getEntity(collection, id)` | `Promise<Entity>` | Get a single entity |
| `getSyncState()` | `Promise<SyncState>` | Get current sync state |