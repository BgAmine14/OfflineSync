---
title: '@offlinesync/transport-http'
---

# @offlinesync/transport-http

HTTP transport using the global `fetch` API. Works in Node.js, Bun, Deno, Cloudflare Workers, and browsers.

## HttpSyncTransport

```typescript
import { HttpSyncTransport } from '@offlinesync/transport-http'

const transport = new HttpSyncTransport({
  syncEndpoint: 'https://api.example.com/sync',
  snapshotEndpoint: 'https://api.example.com/snapshot',
  clientId: 'client-abc',
  headers: { Authorization: 'Bearer token' },
})
```

### Options

| Option | Type | Description |
|---|---|---|
| `syncEndpoint` | `string` | URL for incremental sync |
| `snapshotEndpoint?` | `string` | URL for snapshot sync |
| `clientId` | `string` | Client identifier sent with each request |
| `headers?` | `Record<string, string>` | Custom headers (e.g., auth) |
| `fetchFn?` | `typeof fetch` | Custom fetch implementation |

## SyncTransportError

```typescript
import { SyncTransportError } from '@offlinesync/transport-http'

try {
  await transport.sendSync(request)
} catch (e) {
  if (e instanceof SyncTransportError) {
    console.log(e.code)  // Protocol error code
  }
}
```

| Property | Type | Description |
|---|---|---|
| `code` | `string` | Mapped protocol error code |
| `cause?` | `Error` | Original error |
