---
layout: home

hero:
  name: "OfflineSync"
  text: "Local-first sync engine"
  tagline: Build apps that work offline, sync automatically, and resolve conflicts — with zero runtime dependencies in core.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/core

features:
  - icon: \u26a1
    title: Local-First
    details: All data is stored locally first. Reads never block on the network. Your app is always fast and responsive.
  - icon: \ud83d\udd04
    title: Offline Mutations
    details: Writes are queued durably and replayed when connectivity returns. Crash-safe atomic transactions protect every write.
  - icon: \ud83d\udce1
    title: Incremental Sync
    details: Only changed data is transmitted using cursor-based pagination. Minimal bandwidth, maximum efficiency.
  - icon: \ud83d\udee0\ufe0f
    title: 6 Conflict Strategies
    details: Last-write-wins, server-wins, client-wins, field-merge, operation-aware, and manual — with per-collection routing.
  - icon: \ud83d\udcf1
    title: Framework Integrations
    details: First-class React hooks, Vue composables, and Electron IPC bridge. Drop-in with your existing stack.
  - icon: \ud83d\udd12
    title: Zero Deps (Core)
    details: Core packages have zero runtime dependencies. Pure TypeScript. Works in Node.js, Bun, Deno, and browsers.
  - icon: \ud83c\udf10
    title: LAN Discovery
    details: Pluggable peer discovery for local network synchronization. Build your own backend with the DiscoveryBackend interface.
  - icon: \ud83d\udcca
    title: 759 Tests
    details: Comprehensive test suite covering unit, integration, property-based, stress, and benchmark scenarios across 52 test files.
---

## 12 Packages, 4 Layers

OfflineSync is a monorepo organized into four layers: protocol, storage, core engine, and platform integrations.

```text
\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2574
\u2502  Platform Integrations                                                  \u2502
\u2502  React hooks \u00b7 Vue composables \u00b7 Electron IPC \u00b7 Discovery       \u2502
\u255c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2564
\u2502  Core Engine                                                        \u2502
\u2502  SyncEngine \u00b7 Collection \u00b7 MutationQueue \u00b7 ConflictResolver        \u2502
\u2502  RecoveryManager \u00b7 IntegrityChecker \u00b7 SyncScheduler               \u2502
\u255c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2564
\u2502  Transport Layer                                                    \u2502
\u2502  transport-http (request/response) \u00b7 transport-websocket (push)       \u2502
\u255c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2564
\u2502  Protocol & Storage                                                \u2502
\u2502  protocol (wire types) \u00b7 storage (interface) \u00b7 storage-sqlite          \u2502
\u2502  conflict (strategies) \u00b7 server (ref implementation)                   \u2502
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
```

## Quick Start

```bash
npm install @offlinesync/core @offlinesync/storage-sqlite @offlinesync/transport-http
```

```typescript
import { Collection, MutationRecorder, MutationQueue, SyncEngine, SyncScheduler } from '@offlinesync/core'
import { SQLiteStorageAdapter } from '@offlinesync/storage-sqlite'
import { HttpSyncTransport } from '@offlinesync/transport-http'
import { ConflictResolutionManager, LastWriteWinsStrategy } from '@offlinesync/conflict'

const storage = new SQLiteStorageAdapter({ dbPath: './myapp.db' })
const recorder = new MutationRecorder({ idGenerator: { generate: () => crypto.randomUUID() } })
const queue = new MutationQueue({ storage })

const tasks = new Collection<{ title: string; done: boolean }>('tasks', storage, {
  mutationRecorder: recorder,
  mutationQueue: queue,
})

// Write data locally — works offline!
await tasks.create('task-1', { title: 'Build offline sync', done: false })

// Configure and start syncing
const transport = new HttpSyncTransport({
  syncEndpoint: 'https://api.example.com/sync',
  clientId: 'client-abc',
})
const conflictManager = new ConflictResolutionManager({
  defaultStrategy: 'last-write-wins',
  strategies: { 'last-write-wins': new LastWriteWinsStrategy() },
})
const engine = new SyncEngine({ clientId: 'client-abc', storage, mutationQueue: queue, transport, conflictResolver: conflictManager })
const scheduler = new SyncScheduler({ engine })
scheduler.start()
```
