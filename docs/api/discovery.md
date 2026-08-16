---
title: '@offlinesync/discovery'
---

# @offlinesync/discovery

Pluggable LAN peer discovery service. **Zero dependencies**.

## DiscoveryService

```typescript
import { DiscoveryService, InMemoryDiscoveryBackend } from '@offlinesync/discovery'

const discovery = new DiscoveryService({
  backend: new InMemoryDiscoveryBackend(),
  metadata: { name: 'My App' },
})

discovery.onPeerDiscovered((peer) => {
  console.log(`Found peer: ${peer.id} at ${peer.endpoint}`)
})

discovery.onPeerLost((peer) => {
  console.log(`Lost peer: ${peer.id}`)
})

await discovery.start()
// ... later
await discovery.stop()
```

### Options

| Option | Type | Description |
|---|---|---|
| `backend` | `DiscoveryBackend` | Pluggable discovery backend |
| `metadata?` | `Record<string, unknown>` | Metadata sent with this peer |

### Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `Promise<void>` | Begin discovery |
| `stop()` | `Promise<void>` | Stop discovery |
| `discover()` | `Promise<PeerInfo[]>` | Get current peer list |
| `onPeerDiscovered(cb)` | `void` | Register peer found callback |
| `onPeerLost(cb)` | `void` | Register peer lost callback |

## Implementing a Custom Backend

```typescript
import type { DiscoveryBackend, PeerInfo } from '@offlinesync/discovery'

class MDNSBackend implements DiscoveryBackend {
  async start() { /* ... */ }
  async stop() { /* ... */ }
  onPeerFound?: (peer: PeerInfo) => void
  onPeerLost?: (peer: PeerInfo) => void
}
```

## Types

| Export | Description |
|---|---|
| `PeerInfo` | `{ id, endpoint, metadata? }` |
| `DiscoveryBackend` | Interface: `start()`, `stop()`, `onPeerFound?`, `onPeerLost?` |
| `DiscoveryState` | `'STOPPED' | 'STARTING' | 'ACTIVE' | 'STOPPING'` |
| `DiscoveryError` | Discovery-specific error class |
