---
title: '@offlinesync/conflict'
---

# @offlinesync/conflict

Conflict detection and resolution framework. **Zero dependencies**.

## ConflictResolutionManager

```typescript
import { ConflictResolutionManager, LastWriteWinsStrategy, FunctionStrategy } from '@offlinesync/conflict'

const manager = new ConflictResolutionManager({
  defaultStrategy: 'last-write-wins',
  strategies: {
    'last-write-wins': new LastWriteWinsStrategy(),
    'tasks': new FunctionStrategy(async (ctx) => ({
      outcome: 'resolved',
      data: { ...ctx.serverData, ...ctx.clientData },
    })),
  },
  onConflict: (ctx) => console.log(`Conflict on ${ctx.entityId}`),
})

const resolution = await manager.resolve('tasks', {
  entityId: 'task-1',
  collectionName: 'tasks',
  clientVersion: { revision: 2, data: { title: 'My task' } },
  serverVersion: { revision: 3, data: { title: 'Your task' } },
})
```

| Method | Returns | Description |
|---|---|---|
| `resolve(collectionName, context)` | `Promise<ConflictResolution>` | Route and resolve a conflict |
| `registerStrategy(name, strategy)` | `void` | Register a named strategy |

## Built-in Strategies

| Strategy | Description |
|---|---|
| `ServerWinsStrategy` | Always returns `server-wins` with server data |
| `ClientWinsStrategy` | Always returns `client-wins` with client data |
| `LastWriteWinsStrategy` | Compares `updatedAt` timestamps, picks newer |
| `FieldMergeStrategy` | Merges individual fields; server wins on collision |
| `OperationAwareStrategy` | Uses operation type for smarter resolution |
| `ManualStrategy` | Returns `manual` for app-level handling |
| `FunctionStrategy` | Wraps a user-provided resolver function |

## Types

| Export | Description |
|---|---|
| `ConflictContext` | `{ entityId, collectionName, clientVersion, serverVersion, clientData, serverData, operation }` |
| `ConflictResolution` | `{ outcome: 'resolved' | 'client-wins' | 'server-wins' | 'manual', data? }` |
| `ConflictResolver` | `(context: ConflictContext) => Promise<ConflictResolution>` |
| `BuiltInStrategyName` | Union of built-in strategy name literals |

## Strategy Names

```typescript
import { BUILT_IN_STRATEGY } from '@offlinesync/conflict'

BUILT_IN_STRATEGY.SERVER_WINS       // 'server-wins'
BUILT_IN_STRATEGY.CLIENT_WINS       // 'client-wins'
BUILT_IN_STRATEGY.LAST_WRITE_WINS   // 'last-write-wins'
BUILT_IN_STRATEGY.FIELD_MERGE       // 'field-merge'
BUILT_IN_STRATEGY.OPERATION_AWARE   // 'operation-aware'
BUILT_IN_STRATEGY.MANUAL            // 'manual'
```
