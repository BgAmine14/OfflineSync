---
title: '@offlinesync/server'
---

# @offlinesync/server

Reference in-memory sync server for testing and development.

## SyncServer

```typescript
import { SyncServer } from '@offlinesync/server'

const server = new SyncServer()

// Handle a sync request
const response = await server.sync({
  clientId: 'client-1',
  mutations: [],
  cursor: undefined,
})

// Handle a snapshot request
const snapshot = await server.snapshot({
  clientId: 'client-1',
  collections: ['tasks', 'users'],
})

// Server stats
console.log(server.getStats())
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `sync(request)` | `Promise<SyncResponse>` | Process incremental sync |
| `snapshot(request)` | `Promise<SnapshotResponse>` | Process snapshot sync |
| `getStats()` | `object` | Server statistics |

## ServerChangeLog

Tracks server-side changes per client cursor. Supports cursor-based pagination and pruning.

## ServerMutationTracker

Records mutations received from clients. Provides INV-5 deduplication — each mutation is processed exactly once.
