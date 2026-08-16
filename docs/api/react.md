---
title: '@offlinesync/react'
---

# @offlinesync/react

React hooks for OfflineSync. Peer dependency: `react >= 17.0.0`.

## OfflineSyncProvider

Wrap your app to provide the sync context:

```tsx
import { OfflineSyncProvider } from '@offlinesync/react'

function App() {
  return (
    <OfflineSyncProvider
      engine={syncEngine}
      storage={storage}
      mutationRecorder={recorder}
      mutationQueue={queue}
    >
      <TaskList />
    </OfflineSyncProvider>
  )
}
```

## useOfflineSync

One-hook setup returning the collection factory and engine:

```tsx
function TaskList() {
  const { useCollection, useEntity, useSyncState, engine } = useOfflineSync()
  const { entities, loading, error, syncState } = useCollection('tasks')

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

## useCollection

```tsx
const { entities, loading, error, syncState } = useCollection<Task>('tasks', {
  pollInterval: 5000,
})
```

| Field | Type | Description |
|---|---|---|
| `entities` | `Entity<T>[]` | Current entities in the collection |
| `loading` | `boolean` | Whether entities are being loaded |
| `error` | `Error \| null` | Error if loading failed |
| `syncState` | `SyncState` | Current sync state |

## useEntity

```tsx
const { entity, loading, error } = useEntity<Task>('tasks', 'task-1')
```

## useSyncState

```tsx
const { syncState, pendingMutations, lastSyncAt } = useSyncState()
```
