/**
 * Benchmark: Sync cycle simulation — measure time for full sync with N entities.
 *
 * This test measures the time for a complete sync cycle including
 * snapshot sync and incremental sync with a large dataset.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine.js';
import { MutationQueue } from '../../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { StubSyncTransport } from '../../src/sync-transport.js';
import type {
  SnapshotResponse,
  SyncResponse,
  Change,
} from '@offlinesync/protocol';

const ENTITY_COUNT = 1_000;
const COLLECTION_NAME = 'sync-bench-items';

interface SyncBenchData {
  readonly name: string;
  readonly value: number;
}

describe('benchmark: sync cycle simulation', () => {
  let adapter: InMemoryStorageAdapter;
  let mutationQueue: MutationQueue;
  let transport: StubSyncTransport;
  let engine: SyncEngine;

  function buildSnapshotResponse(): SnapshotResponse {
    const now = new Date().toISOString();
    const entities: Record<string, unknown[]> = {
      [COLLECTION_NAME]: [],
    };

    for (let index = 0; index < ENTITY_COUNT; index++) {
      const collectionEntities = entities[COLLECTION_NAME];
      if (Array.isArray(collectionEntities)) {
        collectionEntities.push({
          id: `snap-entity-${index}`,
          data: { name: `Snapshot Item ${index}`, value: index },
          revision: 1,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        });
      }
    }

    return {
      entities,
      cursor: `snapshot-cursor-${ENTITY_COUNT}`,
      serverTimestamp: now,
    };
  }

  function buildIncrementalResponse(): SyncResponse {
    const now = new Date().toISOString();
    const changes: Change[] = [];

    for (let index = 0; index < ENTITY_COUNT; index++) {
      changes.push({
        serverSequence: index + 1,
        collectionName: COLLECTION_NAME,
        entity: {
          id: `inc-entity-${index}`,
          data: { name: `Incremental Item ${index}`, value: index * 2 },
          revision: 1,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        },
        operation: 'set',
        field: null,
        value: { name: `Incremental Item ${index}`, value: index * 2 },
      });
    }

    return {
      changes,
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: `inc-cursor-${ENTITY_COUNT}`,
    };
  }

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    mutationQueue = new MutationQueue({ storage: adapter });
    transport = new StubSyncTransport();
    engine = new SyncEngine({
      clientId: 'bench-client',
      storage: adapter,
      mutationQueue,
      transport,
    });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should complete snapshot sync with 1,000 entities in under 10 seconds', async () => {
    const snapshotResponse = buildSnapshotResponse();
    transport.setNextSnapshotResponse(snapshotResponse);

    const start = performance.now();
    const result = await engine.sync();
    const duration = performance.now() - start;

    // Verify correctness
    expect(result.wasSnapshot).toBe(true);
    expect(result.changesApplied).toBe(ENTITY_COUNT);

    // Verify a sample entity
    const entity = await adapter.get<SyncBenchData>(
      COLLECTION_NAME,
      'snap-entity-500',
    );
    expect(entity.data.name).toBe('Snapshot Item 500');

    // Assert performance bound
    expect(duration).toBeLessThan(10_000);
  });

  it('should complete incremental sync with 1,000 changes in under 10 seconds', async () => {
    // First, do a snapshot sync to establish cursor
    const snapshotResponse = buildSnapshotResponse();
    transport.setNextSnapshotResponse(snapshotResponse);
    await engine.sync();

    // Now perform incremental sync with 1,000 changes
    const incrementalResponse = buildIncrementalResponse();
    transport.setNextSyncResponse(incrementalResponse);

    const start = performance.now();
    const result = await engine.sync();
    const duration = performance.now() - start;

    // Verify correctness
    expect(result.wasSnapshot).toBe(false);
    expect(result.changesApplied).toBe(ENTITY_COUNT);

    // Assert performance bound
    expect(duration).toBeLessThan(10_000);
  });
});
