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
  - icon: "⚡"
    title: Local-First
    details: All data is stored locally first. Reads never block on the network. Your app is always fast and responsive.
  - icon: "🔄"
    title: Offline Mutations
    details: Writes are queued durably and replayed when connectivity returns. Crash-safe atomic transactions protect every write.
  - icon: "📡"
    title: Incremental Sync
    details: Only changed data is transmitted using cursor-based pagination. Minimal bandwidth, maximum efficiency.
  - icon: "🔧"
    title: 6 Conflict Strategies
    details: Last-write-wins, server-wins, client-wins, field-merge, operation-aware, and manual — with per-collection routing.
  - icon: "📱"
    title: Framework Integrations
    details: First-class React hooks, Vue composables, and Electron IPC bridge. Drop-in with your existing stack.
  - icon: "🔒"
    title: Zero Deps (Core)
    details: Core packages have zero runtime dependencies. Pure TypeScript. Works in Node.js, Bun, Deno, and browsers.
  - icon: "🌐"
    title: LAN Discovery
    details: Pluggable peer discovery for local network synchronization. Build your own backend with the DiscoveryBackend interface.
  - icon: "📊"
    title: 759 Tests
    details: Comprehensive test suite covering unit, integration, property-based, stress, and benchmark scenarios across 52 test files.
---

## 12 Packages, 4 Layers

OfflineSync is a monorepo organized into four layers: protocol, storage, core engine, and platform integrations.

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Integrations                                              │
│  React hooks · Vue composables · Electron IPC · Discovery           │
├──────────────────────────────────────────────────────────────────────┤
│  Core Engine                                                        │
│  SyncEngine · Collection · MutationQueue · ConflictResolver         │
│  RecoveryManager · IntegrityChecker · SyncScheduler                 │
├──────────────────────────────────────────────────────────────────────┤
│  Transport Layer                                                    │
│  transport-http (request/response) · transport-websocket (push)     │
├──────────────────────────────────────────────────────────────────────┤
│  Protocol & Storage                                                 │
│  protocol (wire types) · storage (interface) · storage-sqlite       │
│  conflict (strategies) · server (ref implementation)                 │
└──────────────────────────────────────────────────────────────────────┘
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
