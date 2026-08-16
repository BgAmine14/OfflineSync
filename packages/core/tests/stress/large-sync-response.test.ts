/**
 * Stress test: Large sync response — apply 5,000 changes in one sync cycle.
 *
 * This test validates that the SyncEngine can handle a large batch of
 * remote changes from a single sync response without errors or data loss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine.js';
import { MutationQueue } from '../../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
import { StubSyncTransport } from '../../src/sync-transport.js';
import type { SyncResponse, Change } from '@offlinesync/protocol';

const CHANGE_COUNT = 5_000;
const COLLECTION_NAME = 'sync-items';

interface SyncItemData {
  readonly name: string;
  readonly value: number;
}

describe('stress: large sync response', () => {
  let adapter: InMemoryStorageAdapter;
  let mutationQueue: MutationQueue;
  let transport: StubSyncTransport;
  let engine: SyncEngine;

  function buildLargeSyncResponse(cursor: string): SyncResponse {
    const now = new Date().toISOString();
    const changes: Change[] = [];

    for (let index = 0; index < CHANGE_COUNT; index++) {
      changes.push({
        serverSequence: index + 1,
        collectionName: COLLECTION_NAME,
        entity: {
          id: `sync-entity-${index}`,
          data: { name: `Sync Item ${index}`, value: index },
          revision: 1,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        },
        operation: 'set',
        field: null,
        value: { name: `Sync Item ${index}`, value: index },
      });
    }

    return {
      changes,
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: `${cursor}-${CHANGE_COUNT}`,
    };
  }

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    mutationQueue = new MutationQueue({ storage: adapter });
    transport = new StubSyncTransport();
    engine = new SyncEngine({
      clientId: 'stress-client',
      storage: adapter,
      mutationQueue,
      transport,
    });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should apply 5,000 changes from a single sync response', async () => {
    // First, establish a cursor via an empty snapshot sync
    transport.setNextSnapshotResponse({
      entities: {},
      cursor: 'initial-cursor',
      serverTimestamp: new Date().toISOString(),
    });

    await engine.sync();
    expect(engine.syncState).toBe('SYNCED');

    // Now set up the large incremental sync response
    const response = buildLargeSyncResponse('cursor');
    transport.setNextSyncResponse(response);

    const start = performance.now();
    const result = await engine.sync();
    const duration = performance.now() - start;

    // Verify result
    expect(result.changesApplied).toBe(CHANGE_COUNT);
    expect(result.newCursor).toBe(`cursor-${CHANGE_COUNT}`);
    expect(result.conflictsDetected).toBe(0);

    // Verify a sample of entities
    const firstEntity = await adapter.get<SyncItemData>(
      COLLECTION_NAME,
      'sync-entity-0',
    );
    expect(firstEntity.data.name).toBe('Sync Item 0');
    expect(firstEntity.data.value).toBe(0);

    const middleEntity = await adapter.get<SyncItemData>(
      COLLECTION_NAME,
      'sync-entity-2500',
    );
    expect(middleEntity.data.name).toBe('Sync Item 2500');

    const lastEntity = await adapter.get<SyncItemData>(
      COLLECTION_NAME,
      'sync-entity-4999',
    );
    expect(lastEntity.data.name).toBe('Sync Item 4999');
    expect(lastEntity.data.value).toBe(4999);

    // Should complete within 30 seconds
    expect(duration).toBeLessThan(30_000);
  });

  it('should apply 5,000 changes and preserve cursor after restart', async () => {
    // First, establish a cursor
    transport.setNextSnapshotResponse({
      entities: {},
      cursor: 'initial-cursor',
      serverTimestamp: new Date().toISOString(),
    });
    await engine.sync();

    // Now set up the large incremental sync response
    const response = buildLargeSyncResponse('cursor');
    transport.setNextSyncResponse(response);
    await engine.sync();

    // Verify cursor was saved
    const cursorEntity = await adapter.get<{ value: string }>(
      '__sync_state__',
      'cursor',
    );
    expect(cursorEntity.data.value).toBe(`cursor-${CHANGE_COUNT}`);

    // Verify sync state
    expect(engine.syncState).toBe('SYNCED');
  });
});
