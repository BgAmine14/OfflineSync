---
title: '@offlinesync/storage-sqlite'
---

# @offlinesync/storage-sqlite

High-performance SQLite implementation of `StorageAdapter` using [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3).

## SQLiteStorageAdapter

```typescript
import { SQLiteStorageAdapter } from '@offlinesync/storage-sqlite'

const storage = new SQLiteStorageAdapter({ dbPath: './myapp.db' })

// Use with OfflineSync
const tasks = new Collection('tasks', storage, { mutationRecorder, mutationQueue })

// When done
await storage.close()
```

### Options

| Option | Type | Description |
|---|---|---|
| `dbPath` | `string` | Path to the SQLite database file |

### Features

- **Automatic schema creation** — Tables are created on first use
- **Atomic transactions** — Uses SQLite's `BEGIN`/`COMMIT` for crash safety
- **Synchronous API** — better-sqlite3 is synchronous, eliminating async overhead
- **Query translation** — Converts the `Query` API to SQL with filtering, sorting, and pagination
