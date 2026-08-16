---
title: '@offlinesync/vue'
---

# @offlinesync/vue

Vue composables for OfflineSync. Peer dependency: `vue >= 3.0.0`.

## provideOfflineSync

Provide the sync context at the root of your app:

```vue
<script setup lang="ts">
import { provideOfflineSync } from '@offlinesync/vue'

provideOfflineSync({ engine, storage, mutationRecorder, mutationQueue })
</script>

<template>
  <TaskList />
</template>
```

## useOfflineSync

One-composable setup:

```vue
<script setup lang="ts">
import { useOfflineSync } from '@offlinesync/vue'

const { useCollection, useEntity, useSyncState, engine } = useOfflineSync()
const { entities, loading, error, syncState } = useCollection('tasks')
</script>

<template>
  <ul v-if="!loading && !error">
    <li v-for="e in entities" :key="e.id">{{ e.data.title }}</li>
  </ul>
</template>
```

## useCollection

```vue
<script setup lang="ts">
const { entities, loading, error, syncState } = useCollection<Task>('tasks', {
  pollInterval: 5000,
})
</script>
```

| Field | Type | Description |
|---|---|---|
| `entities` | `Ref<Entity<T>[]>` | Reactive entities array |
| `loading` | `Ref<boolean>` | Loading state |
| `error` | `Ref<Error | null>` | Error state |
| `syncState` | `Ref<SyncState>` | Current sync state |

## useEntity

```vue
<script setup lang="ts">
const { entity, loading, error } = useEntity<Task>('tasks', 'task-1')
</script>
```

## useSyncState

```vue
<script setup lang="ts">
const { syncState, pendingMutations, lastSyncAt } = useSyncState()
</script>
```