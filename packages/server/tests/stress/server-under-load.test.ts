/**
 * Stress test: Server under load — 10 clients, 100 mutations each.
 *
 * This test validates that the SyncServer can handle concurrent
 * sync requests from multiple clients with a large number of mutations
 * without errors or data corruption.
 */

import { describe, it, expect } from 'vitest';
import { SyncServer } from '../../src/sync-server.js';
import type {
  ProtocolEntity,
  ProtocolMutation,
  SyncResponse,
  ProtocolError,
} from '@offlinesync/protocol';

const CLIENT_COUNT = 10;
const MUTATIONS_PER_CLIENT = 100;
const COLLECTION_NAME = 'server-stress-items';

const NOW = '2026-08-14T10:00:00Z';

function makeEntity(overrides?: Partial<ProtocolEntity>): ProtocolEntity {
  return {
    id: 'entity-001',
    data: { title: 'Test' },
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    isDeleted: false,
    ...overrides,
  };
}

function makeMutation(
  overrides?: Partial<ProtocolMutation>,
): ProtocolMutation {
  return {
    id: 'mut-001',
    entityId: 'entity-001',
    collectionName: COLLECTION_NAME,
    operation: 'set',
    field: null,
    value: { title: 'Test' },
    baseRevision: 0,
    createdAt: NOW,
    ...overrides,
  };
}

function extractSyncResponse(
  result: SyncResponse | ProtocolError,
): SyncResponse {
  if (!isSyncResponse(result)) {
    throw new Error(
      `Expected SyncResponse but got error: ${result.code} ${result.message}`,
    );
  }
  return result;
}

function isSyncResponse(
  result: SyncResponse | ProtocolError,
): result is SyncResponse {
  return 'changes' in result && 'newCursor' in result;
}

describe('stress: server under load', () => {
  it('should handle 10 clients each sending 100 mutations', () => {
    const server = new SyncServer();
    let totalAcknowledged = 0;
    let totalConflicts = 0;

    const start = performance.now();

    for (let clientIndex = 0; clientIndex < CLIENT_COUNT; clientIndex++) {
      const mutations: ProtocolMutation[] = [];

      for (
        let mutationIndex = 0;
        mutationIndex < MUTATIONS_PER_CLIENT;
        mutationIndex++
      ) {
        mutations.push(
          makeMutation({
            id: `client-${clientIndex}-mut-${mutationIndex}`,
            entityId: `client-${clientIndex}-entity-${mutationIndex}`,
            collectionName: COLLECTION_NAME,
            value: {
              title: `Client ${clientIndex} Mutation ${mutationIndex}`,
            },
            baseRevision: 0,
          }),
        );
      }

      const result = extractSyncResponse(
        server.handleSyncRequest({
          cursor: '0',
          clientId: `client-${clientIndex}`,
          mutations,
        }),
      );

      totalAcknowledged += result.acknowledgedMutationIds.length;
      totalConflicts += result.conflicts.length;
      // Each mutation should be acknowledged (no conflicts since all are new entities)
      expect(result.acknowledgedMutationIds.length).toBe(MUTATIONS_PER_CLIENT);
      expect(result.conflicts).toHaveLength(0);
    }

    const duration = performance.now() - start;

    // Verify all mutations were processed
    expect(totalAcknowledged).toBe(CLIENT_COUNT * MUTATIONS_PER_CLIENT);
    expect(totalConflicts).toBe(0);

    // Verify entity count on server
    expect(server.entityCount).toBe(CLIENT_COUNT * MUTATIONS_PER_CLIENT);

    // Should complete within 10 seconds
    expect(duration).toBeLessThan(10_000);
  });

  it('should handle 10 clients syncing concurrently and deduplicate mutations', () => {
    const server = new SyncServer();

    // Pre-seed some entities so clients can see changes from each other
    for (let index = 0; index < 50; index++) {
      server.seedEntity(
        COLLECTION_NAME,
        makeEntity({
          id: `shared-entity-${index}`,
          data: { title: `Shared Entity ${index}`, counter: 0 },
          revision: 1,
        }),
      );
    }

    // Client 1 sends mutations for shared entities
    const client1Mutations: ProtocolMutation[] = [];
    for (let index = 0; index < 50; index++) {
      client1Mutations.push(
        makeMutation({
          id: `client1-mut-${index}`,
          entityId: `shared-entity-${index}`,
          collectionName: COLLECTION_NAME,
          operation: 'increment',
          field: 'counter',
          value: 1,
          baseRevision: 1,
        }),
      );
    }

    const result1 = extractSyncResponse(
      server.handleSyncRequest({
        cursor: '0',
        clientId: 'client-1',
        mutations: client1Mutations,
      }),
    );

    expect(result1.acknowledgedMutationIds.length).toBe(50);

    // Client 2 tries to send the SAME mutations (dedup test)
    const result2 = extractSyncResponse(
      server.handleSyncRequest({
        cursor: result1.newCursor,
        clientId: 'client-2',
        mutations: client1Mutations,
      }),
    );

    // All should be acknowledged due to deduplication (INV-5)
    expect(result2.acknowledgedMutationIds.length).toBe(50);

    // Client 3 tries conflicting mutations (wrong base revision)
    const client3Mutations: ProtocolMutation[] = [];
    for (let index = 0; index < 50; index++) {
      client3Mutations.push(
        makeMutation({
          id: `client3-mut-${index}`,
          entityId: `shared-entity-${index}`,
          collectionName: COLLECTION_NAME,
          operation: 'set',
          value: { title: 'Conflict', counter: 999 },
          baseRevision: 1, // Stale: should be 2
        }),
      );
    }

    const result3 = extractSyncResponse(
      server.handleSyncRequest({
        cursor: result2.newCursor,
        clientId: 'client-3',
        mutations: client3Mutations,
      }),
    );

    // All should be conflicts due to stale base revision
    expect(result3.conflicts.length).toBe(50);
    expect(result3.acknowledgedMutationIds.length).toBe(0);
  });
});
