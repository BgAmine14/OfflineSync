---
title: '@offlinesync/protocol'
---

# @offlinesync/protocol

Fully independent wire protocol types. **Zero dependencies** on other OfflineSync packages.

## Incremental Sync Types

| Export | Kind | Description |
|---|---|---|
| `SyncRequest` | type | Client → server: `clientId`, `mutations`, `cursor` |
| `SyncResponse` | type | Server → client: `changes`, `conflicts`, `acknowledgedMutationIds`, `serverCursor`, `errors` |
| `Change` | type | A single remote change: `entity`, `type` |
| `ConflictInfo` | type | Conflict detail: `entityId`, `collectionName`, `clientVersion`, `serverVersion` |
| `ProtocolEntity` | type | Wire format entity: `id`, `data`, `revision`, `createdAt`, `updatedAt`, `isDeleted` |
| `ProtocolMutation` | type | Wire format mutation: `id`, `entityId`, `collectionName`, `operation`, `field`, `value`, `sequence`, `createdAt` |

## Snapshot Sync Types

| Export | Kind | Description |
|---|---|---|
| `SnapshotRequest` | type | Full-state request: `clientId`, `collections` |
| `SnapshotResponse` | type | Full-state response: `entitiesByCollection`, `serverCursor` |

## Error Types

| Export | Kind | Description |
|---|---|---|
| `ProtocolError` | type | `{ code: SyncErrorCode, message, classification?, retryAfter? }` |
| `SyncErrorCode` | type | Union of error code string literals |
| `ErrorClassification` | type | `'RETRYABLE' \| 'AUTHENTICATION' \| 'PERMANENT' \| 'UNKNOWN'` |

## Handshake

| Export | Kind | Description |
|---|---|---|
| `CURRENT_PROTOCOL_VERSION` | const | Current supported protocol version |
| `ProtocolVersion` | type | Parsed version: `major`, `minor`, `patch` |
| `negotiateVersion(client, server)` | function | Returns highest mutually supported version |
| `parseVersion(v)` | function | Parses a version string |

## Type Guards

Runtime validation functions for all protocol types:

`isSyncRequest(v)` · `isSyncResponse(v)` · `isSnapshotRequest(v)` · `isSnapshotResponse(v)` · `isProtocolEntity(v)` · `isProtocolMutation(v)` · `isChange(v)` · `isConflictInfo(v)` · `isProtocolError(v)` · `isSyncErrorCode(v)` · `isErrorClassification(v)`

## Constants

| Export | Description |
|---|---|
| `SYNC_ERROR_CODE` | All valid protocol error codes |
| `ERROR_CLASSIFICATION` | Error classification values |
| `ERROR_CODE_CLASSIFICATION` | Maps error codes to classifications |
| `CLASSIFICATION_RETRY_BEHAVIOR` | Maps classifications to `{ shouldRetry }` |
