---
title: Invariants
---

# System Invariants

OfflineSync is built around 9 invariants (referenced as `INV-N` throughout the source code). These are guarantees that the system maintains under all conditions, including crashes, network failures, and concurrent operations.

## Overview

| # | Invariant | Description |
|---|---|---|
| INV-1 | Sequence ordering | Mutations are strictly ordered by sequence number within each collection |
| INV-2 | Idempotency | Sync operations can be safely retried without side effects |
| INV-3 | Cursor consistency | Cursors are updated only after all changes are durable |
| INV-4 | Mutation durability | Pending mutations survive process restarts |
| INV-5 | Exactly-once processing | Each mutation is processed exactly once by the server |
| INV-6 | Conflict detection | Conflicts are detected when server and client versions diverge |
| INV-7 | Resolution determinism | The same conflict inputs always produce the same resolution output |
| INV-8 | Atomic writes | Entity updates and mutation records are stored in the same transaction |
| INV-9 | Backoff | Consecutive sync failures trigger exponential backoff |

## INV-1: Sequence Ordering

Every mutation within a collection is assigned a monotonically increasing sequence number. The `MutationRecorder` tracks the current maximum sequence per collection and assigns the next number on each write. This guarantees that mutations can be replayed in the correct order.

**Enforced by:** `MutationRecorder`

**Tested by:** Property-based tests that verify sequence numbers are strictly increasing across 300+ random operation sequences.

## INV-2: Idempotency

All sync operations are designed to be safely retryable. If a sync cycle is interrupted (network drop, process crash), the next cycle will send the same mutations again. The server uses mutation IDs to deduplicate, ensuring no double-processing.

**Enforced by:** `SyncEngine`, `ServerMutationTracker`

**Tested by:** Integration tests that simulate interrupted sync cycles and verify no data duplication.

## INV-3: Cursor Consistency

The sync cursor (used for incremental sync) is only updated after all received changes have been durably written to storage. This means if a crash occurs during change application, the next sync will re-fetch from the previous cursor — no data is lost.

**Enforced by:** `SyncEngine` (cursor update is the last step after transaction commit)

## INV-4: Mutation Durability

Pending mutations are stored in the same storage transaction as the entity write. If the process crashes between writing an entity and queuing its mutation, both are rolled back. If the process crashes after the transaction commits, the mutation is safely persisted and will be sent on the next sync cycle.

**Enforced by:** `Collection` (uses `storage.transaction()` for atomic writes)

**Tested by:** Stress tests with 10,000 entities and crash simulation tests.

## INV-5: Exactly-Once Processing

Each mutation is processed exactly once by the server. The `ServerMutationTracker` maintains a set of seen mutation IDs and rejects duplicates. This works in combination with INV-2 (idempotent retry) to ensure correctness.

**Enforced by:** `ServerMutationTracker` (INV-5 deduplication)

## INV-6: Conflict Detection

Conflicts are detected when the server and client have divergent versions of the same entity. The protocol includes both `clientVersion` (the revision the client last knew about) and `serverVersion` (the current revision on the server). When these differ and the server has changes the client doesn't know about, a conflict is reported.

**Enforced by:** `SyncEngine`, protocol `ConflictInfo` type

## INV-7: Resolution Determinism

Given the same conflict inputs (client data, server data, operation type), a resolution strategy always produces the same output. This is critical for correctness — two clients resolving the same conflict independently must arrive at the same result.

**Enforced by:** All built-in strategies (pure functions with no side effects)

**Tested by:** Property-based tests that verify deterministic output across 300+ random conflict scenarios.

## INV-8: Atomic Writes

Entity data and mutation records are written in the same storage transaction. This is the foundation for INV-4 (durability) and ensures that the mutation queue is always consistent with the actual entity state.

**Enforced by:** `Collection.create()`, `Collection.put()`, `Collection.update()`, `Collection.delete()` — all use `storage.transaction()`

**Tested by:** Atomic write tests that verify mutation records exist iff the entity write succeeded.

## INV-9: Backoff

When sync fails consecutively, the `SyncScheduler` increases the interval between retries using exponential backoff (`baseInterval * backoffMultiplier^attempt`). This prevents hammering a failing server while still recovering quickly when connectivity returns.

**Enforced by:** `SyncScheduler`

**Default:** 30s base, 2x multiplier, 5 minute cap. On successful sync, the interval resets to the base.