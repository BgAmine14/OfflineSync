---
title: '@offlinesync/transport-websocket'
---

# @offlinesync/transport-websocket

Bidirectional WebSocket transport with server push, version negotiation, and automatic reconnection.

## WebSocketSyncTransport

```typescript
import { WebSocketSyncTransport } from '@offlinesync/transport-websocket'

const transport = new WebSocketSyncTransport({
  url: 'wss://api.example.com/sync',
  clientId: 'client-abc',
  reconnect: true,
})

// Listen for server-pushed changes
transport.onPush((changes, cursor) => {
  console.log(`Received ${changes.length} pushed changes`)
})

// Connection state
transport.onConnectionStateChange((state) => {
  console.log('State:', state) // 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'
})

await transport.connect()
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | WebSocket server URL |
| `clientId?` | `string` | `crypto.randomUUID()` | Client identifier |
| `reconnect?` | `boolean` | `false` | Enable auto-reconnect |
| `WebSocketFactory?` | `(url) => WebSocket` | `globalThis.WebSocket` | Custom WebSocket constructor |

### Methods

| Method | Returns | Description |
|---|---|---|
| `connect()` | `Promise<void>` | Open connection and negotiate version |
| `disconnect()` | `Promise<void>` | Graceful disconnect |
| `dispose()` | `Promise<void>` | Disconnect and release resources |
| `onPush(callback)` | `void` | Register push handler |
| `onConnectionStateChange(callback)` | `void` | Register state change handler |

### Connection States

```typescript
import { WS_CONNECTION_STATE } from '@offlinesync/transport-websocket'

WS_CONNECTION_STATE.CONNECTING
WS_CONNECTION_STATE.CONNECTED
WS_CONNECTION_STATE.DISCONNECTING
WS_CONNECTION_STATE.DISCONNECTED
WS_CONNECTION_STATE.RECONNECTING
```

## WebSocket Message Types

The transport uses a typed message protocol over WebSocket:

| Export | Description |
|---|---|
| `WsClientMessage` | Union of client → server messages |
| `WsServerMessage` | Union of server → client messages |
| `WS_MSG_TYPE` | All message type constants |
| `isWsServerMessage(v)` | Type guard for server messages |
