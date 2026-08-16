import { describe, it, expect } from 'vitest';
import { SyncServer } from '../src/sync-server.js';
import { SYNC_ERROR_CODE } from '@offlinesync/protocol';
import type {
  SyncResponse,
  ProtocolEntity,
  ProtocolMutation,
  ProtocolError,
} from '@offlinesync/protocol';

// --- Helpers ---

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
    collectionName: 'tasks',
    operation: 'set',
    field: null,
    value: { title: 'Test' },
    baseRevision: 0,
    createdAt: NOW,
    ...overrides,
  };
}

function isSyncResponse(
  result: SyncResponse | ProtocolError,
): result is SyncResponse {
  return 'changes' in result && 'newCursor' in result;
}

function isProtocolError(
  result: SyncResponse | ProtocolError,
): result is ProtocolError {
  return 'code' in result && 'message' in result;
}

describe('SyncServer', () => {
  // --- Snapshot Sync ---

  describe('snapshot sync', () => {
    it('should return empty entities when server has no data', () => {
      const server = new SyncServer();
      const response = server.handleSnapshotRequest({
        clientId: 'client-001',
      });

      expect(response.entities).toEqual({});
      expect(response.cursor).toBe('0');
      expect(response.serverTimestamp).toBeDefined();
    });

    it('should return all entities across collections when no filter is provided', () => {
      const server = new SyncServer();
      server.seedEntity('tasks', makeEntity({ id: 'e1' }));
      server.seedEntity('tasks', makeEntity({ id: 'e2' }));
      server.seedEntity('projects', makeEntity({ id: 'e3' }));

      const response = server.handleSnapshotRequest({
        clientId: 'client-001',
      });

      expect(response.entities['tasks']).toHaveLength(2);
      expect(response.entities['projects']).toHaveLength(1);
    });

    it('should filter entities by collection when collections are specified', () => {
      const server = new SyncServer();
      server.seedEntity('tasks', makeEntity({ id: 'e1' }));
      server.seedEntity('projects', makeEntity({ id: 'e2' }));

      const response = server.handleSnapshotRequest({
        collections: ['tasks'],
        clientId: 'client-001',
      });

      expect(response.entities['tasks']).toHaveLength(1);
      // 'projects' is not in the requested collections, so it is not returned
      expect(response.entities['projects']).toBeUndefined();
    });

    it('should include the current cursor in snapshot response', () => {
      const server = new SyncServer();
      server.seedEntity('tasks', makeEntity());
      server.seedEntity('tasks', makeEntity({ id: 'e2' }));

      const response = server.handleSnapshotRequest({
        clientId: 'client-001',
      });

      expect(response.cursor).toBe('2');
    });

    it('should return empty array for requested collection that does not exist', () => {
      const server = new SyncServer();

      const response = server.handleSnapshotRequest({
        collections: ['nonexistent'],
        clientId: 'client-001',
      });

      expect(response.entities['nonexistent']).toEqual([]);
    });
  });

  // --- Incremental Sync ---

  describe('incremental sync', () => {
    it('should return empty changes when no mutations have been applied', () => {
      const server = new SyncServer();
      const result = server.handleSyncRequest({
        cursor: '0',
        mutations: [],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes).toHaveLength(0);
      expect(response.acknowledgedMutationIds).toHaveLength(0);
      expect(response.conflicts).toHaveLength(0);
      expect(response.newCursor).toBe('0');
    });

    it('should apply a new entity mutation and return it as a change', () => {
      const server = new SyncServer();
      const mutation = makeMutation({
        id: 'mut-001',
        entityId: 'e1',
        baseRevision: 0,
        value: { title: 'Buy milk' },
      });

      const result = server.handleSyncRequest({
        cursor: '0',
        mutations: [mutation],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes).toHaveLength(1);
      expect(response.changes[0]?.serverSequence).toBe(1);
      expect(response.changes[0]?.entity.data).toEqual({ title: 'Buy milk' });
      expect(response.changes[0]?.entity.revision).toBe(1);
      expect(response.acknowledgedMutationIds).toEqual(['mut-001']);
      expect(response.newCursor).toBe('1');
    });

    it('should apply multiple mutations and return all changes', () => {
      const server = new SyncServer();
      const mutations = [
        makeMutation({
          id: 'mut-001',
          entityId: 'e1',
          baseRevision: 0,
          value: { title: 'Task 1' },
        }),
        makeMutation({
          id: 'mut-002',
          entityId: 'e2',
          baseRevision: 0,
          value: { title: 'Task 2' },
        }),
      ];

      const result = server.handleSyncRequest({
        cursor: '0',
        mutations,
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes).toHaveLength(2);
      expect(response.acknowledgedMutationIds).toHaveLength(2);
      expect(response.newCursor).toBe('2');
    });

    it('should only return changes after the provided cursor', () => {
      const server = new SyncServer();

      // First sync: apply mutation
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { title: 'Task 1' },
          }),
        ],
        clientId: 'client-001',
      });

      // Second sync with cursor from first
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e2',
            baseRevision: 0,
            value: { title: 'Task 2' },
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      // Should only have the new mutation's change, not the old one
      expect(response.changes).toHaveLength(1);
      expect(response.changes[0]?.entity.id).toBe('e2');
      expect(response.newCursor).toBe('2');
    });
  });

  // --- Mutation Deduplication (INV-5) ---

  describe('mutation deduplication', () => {
    it('should acknowledge a duplicate mutation without re-applying it', () => {
      const server = new SyncServer();
      const mutation = makeMutation({
        id: 'mut-001',
        entityId: 'e1',
        baseRevision: 0,
        value: { title: 'Original' },
      });

      // First sync
      server.handleSyncRequest({
        cursor: '0',
        mutations: [mutation],
        clientId: 'client-001',
      });

      // Second sync with same mutation (simulating retry)
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [mutation],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.acknowledgedMutationIds).toEqual(['mut-001']);
      // No new changes should be generated
      expect(response.changes).toHaveLength(0);
      // Entity count should still be 1
      expect(server.entityCount).toBe(1);
    });

    it('should not create extra change log entries for duplicate mutations', () => {
      const server = new SyncServer();
      const mutation = makeMutation({
        id: 'mut-001',
        entityId: 'e1',
        baseRevision: 0,
        value: { title: 'Test' },
      });

      server.handleSyncRequest({
        cursor: '0',
        mutations: [mutation],
        clientId: 'client-001',
      });
      expect(server.getChangeLog().size).toBe(1);

      server.handleSyncRequest({
        cursor: '1',
        mutations: [mutation],
        clientId: 'client-001',
      });
      expect(server.getChangeLog().size).toBe(1);
    });
  });

  // --- Conflict Detection (INV-2) ---

  describe('conflict detection', () => {
    it('should report a conflict when baseRevision does not match server revision', () => {
      const server = new SyncServer();

      // Client A creates entity
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-a',
            entityId: 'e1',
            baseRevision: 0,
            value: { title: 'Version 1' },
          }),
        ],
        clientId: 'client-a',
      });

      // Client B modifies the entity (server now at revision 2 after patch)
      server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-b',
            entityId: 'e1',
            operation: 'patch',
            field: null,
            value: { status: 'done' },
            baseRevision: 1,
          }),
        ],
        clientId: 'client-b',
      });

      // Client A tries to modify based on stale revision 1
      const result = server.handleSyncRequest({
        cursor: '2',
        mutations: [
          makeMutation({
            id: 'mut-a2',
            entityId: 'e1',
            operation: 'patch',
            field: null,
            value: { title: 'Version 2' },
            baseRevision: 1, // Stale! Server is at revision 2
          }),
        ],
        clientId: 'client-a',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.conflicts).toHaveLength(1);
      expect(response.conflicts[0]?.mutationId).toBe('mut-a2');
      expect(response.conflicts[0]?.clientRevision).toBe(1);
      expect(response.conflicts[0]?.serverRevision).toBe(2);
      expect(response.acknowledgedMutationIds).toHaveLength(0);
    });

    it('should report conflict when entity does not exist and baseRevision is not zero', () => {
      const server = new SyncServer();

      const result = server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 5, // Entity doesn't exist, so this is wrong
            value: { title: 'Test' },
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.conflicts).toHaveLength(1);
      expect(response.conflicts[0]?.clientRevision).toBe(5);
      expect(response.conflicts[0]?.serverRevision).toBe(0);
    });
  });

  // --- Operation Application ---

  describe('operation application', () => {
    it('should apply set operation by replacing entity data', () => {
      const server = new SyncServer();

      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            operation: 'set',
            value: { title: 'Task A', priority: 'high' },
          }),
        ],
        clientId: 'client-001',
      });

      // Now set again with completely different data
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'set',
            value: { name: 'Totally different' },
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes[0]?.entity.data).toEqual({
        name: 'Totally different',
      });
    });

    it('should apply patch operation by merging into entity data', () => {
      const server = new SyncServer();

      // Create entity
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { title: 'Task A', count: 0 },
          }),
        ],
        clientId: 'client-001',
      });

      // Patch
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'patch',
            value: { status: 'done' },
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const data = response.changes[0]?.entity.data as Record<string, unknown>;
      expect(data.title).toBe('Task A');
      expect(data.status).toBe('done');
      expect(data.count).toBe(0);
    });

    it('should apply increment operation to a numeric field', () => {
      const server = new SyncServer();

      // Create entity with count = 5
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { count: 5 },
          }),
        ],
        clientId: 'client-001',
      });

      // Increment count by 3
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'increment',
            field: 'count',
            value: 3,
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const data = response.changes[0]?.entity.data as Record<string, unknown>;
      expect(data.count).toBe(8);
    });

    it('should apply decrement operation to a numeric field', () => {
      const server = new SyncServer();

      // Create entity with count = 10
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { count: 10 },
          }),
        ],
        clientId: 'client-001',
      });

      // Decrement count by 4
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'decrement',
            field: 'count',
            value: 4,
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const data = response.changes[0]?.entity.data as Record<string, unknown>;
      expect(data.count).toBe(6);
    });

    it('should apply add operation to an array field', () => {
      const server = new SyncServer();

      // Create entity with tags array
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { tags: ['a', 'b'] },
          }),
        ],
        clientId: 'client-001',
      });

      // Add 'c' to tags
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'add',
            field: 'tags',
            value: 'c',
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const data = response.changes[0]?.entity.data as Record<string, unknown>;
      expect(data.tags).toEqual(['a', 'b', 'c']);
    });

    it('should apply remove operation to an array field', () => {
      const server = new SyncServer();

      // Create entity with tags array
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { tags: ['a', 'b', 'c'] },
          }),
        ],
        clientId: 'client-001',
      });

      // Remove 'b' from tags
      const result = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'remove',
            field: 'tags',
            value: 'b',
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const data = response.changes[0]?.entity.data as Record<string, unknown>;
      expect(data.tags).toEqual(['a', 'c']);
    });

    it('should increment entity revision on every write', () => {
      const server = new SyncServer();

      const r1 = server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-001',
            entityId: 'e1',
            baseRevision: 0,
            value: { v: 1 },
          }),
        ],
        clientId: 'client-001',
      });

      const r2 = server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-002',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'patch',
            value: { v: 2 },
          }),
        ],
        clientId: 'client-001',
      });

      const r3 = server.handleSyncRequest({
        cursor: '2',
        mutations: [
          makeMutation({
            id: 'mut-003',
            entityId: 'e1',
            baseRevision: 2,
            operation: 'patch',
            value: { v: 3 },
          }),
        ],
        clientId: 'client-001',
      });

      expect((r1 as SyncResponse).changes[0]?.entity.revision).toBe(1);
      expect((r2 as SyncResponse).changes[0]?.entity.revision).toBe(2);
      expect((r3 as SyncResponse).changes[0]?.entity.revision).toBe(3);
    });
  });

  // --- Cursor Management ---

  describe('cursor management', () => {
    it('should return CURSOR_TOO_OLD error when client cursor is below minimum', () => {
      const server = new SyncServer();

      // Create 5 entries
      for (let i = 0; i < 5; i++) {
        server.seedEntity(
          'tasks',
          makeEntity({ id: `e${i}` }),
        );
      }

      // Set minimum to 3 (prune entries 1 and 2)
      server.setMinimumAvailableCursor('3');

      // Client with cursor 2 should get CURSOR_TOO_OLD
      const result = server.handleSyncRequest({
        cursor: '2',
        mutations: [],
        clientId: 'client-001',
      });

      expect(isProtocolError(result)).toBe(true);
      const error = result as ProtocolError;
      expect(error.code).toBe(SYNC_ERROR_CODE.CURSOR_TOO_OLD);
      expect(error.details?.minimumAvailableCursor).toBe('3');
    });

    it('should allow sync when cursor equals minimumAvailableCursor', () => {
      const server = new SyncServer();

      for (let i = 0; i < 5; i++) {
        server.seedEntity(
          'tasks',
          makeEntity({ id: `e${i}` }),
        );
      }

      server.setMinimumAvailableCursor('3');

      const result = server.handleSyncRequest({
        cursor: '3',
        mutations: [],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes).toHaveLength(2); // entries 4 and 5
      expect(response.newCursor).toBe('5');
    });

    it('should start with cursor zero when no mutations have been applied', () => {
      const server = new SyncServer();
      expect(server.currentCursor).toBe('0');
    });

    it('should advance cursor after each mutation', () => {
      const server = new SyncServer();

      expect(server.currentCursor).toBe('0');

      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({ id: 'mut-1', entityId: 'e1', baseRevision: 0 }),
        ],
        clientId: 'client-001',
      });
      expect(server.currentCursor).toBe('1');

      server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({ id: 'mut-2', entityId: 'e2', baseRevision: 0 }),
        ],
        clientId: 'client-001',
      });
      expect(server.currentCursor).toBe('2');
    });
  });

  // --- minimumAvailableCursor Pruning ---

  describe('minimumAvailableCursor pruning', () => {
    it('should prune change log and mutation tracker when minimum is set', () => {
      const server = new SyncServer();

      // Apply 5 mutations
      for (let i = 0; i < 5; i++) {
        server.handleSyncRequest({
          cursor: String(i),
          mutations: [
            makeMutation({
              id: `mut-${i}`,
              entityId: `e${i}`,
              baseRevision: 0,
            }),
          ],
          clientId: 'client-001',
        });
      }

      expect(server.getChangeLog().size).toBe(5);
      expect(server.getMutationTracker().size).toBe(5);

      server.setMinimumAvailableCursor('3');

      expect(server.getChangeLog().size).toBe(3);
      expect(server.getMutationTracker().size).toBe(3);
    });

    it('should allow incremental sync after pruning with valid cursor', () => {
      const server = new SyncServer();

      for (let i = 0; i < 5; i++) {
        server.handleSyncRequest({
          cursor: String(i),
          mutations: [
            makeMutation({
              id: `mut-${i}`,
              entityId: `e${i}`,
              baseRevision: 0,
            }),
          ],
          clientId: 'client-001',
        });
      }

      server.setMinimumAvailableCursor('3');

      const result = server.handleSyncRequest({
        cursor: '3',
        mutations: [],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      expect(response.changes).toHaveLength(2);
      expect(response.changes[0]?.serverSequence).toBe(4);
      expect(response.changes[1]?.serverSequence).toBe(5);
    });
  });

  // --- Multi-client scenarios ---

  describe('multi-client scenarios', () => {
    it('should propagate changes from one client to another via incremental sync', () => {
      const server = new SyncServer();

      // Client A creates entity
      const resultA = server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-a',
            entityId: 'e1',
            baseRevision: 0,
            value: { title: 'Created by A' },
          }),
        ],
        clientId: 'client-a',
      });

      expect(isSyncResponse(resultA)).toBe(true);
      const respA = resultA as SyncResponse;
      expect(respA.newCursor).toBe('1');

      // Client B syncs and should see A's change
      const resultB = server.handleSyncRequest({
        cursor: '0',
        mutations: [],
        clientId: 'client-b',
      });

      expect(isSyncResponse(resultB)).toBe(true);
      const respB = resultB as SyncResponse;
      expect(respB.changes).toHaveLength(1);
      expect(respB.changes[0]?.entity.data).toEqual({ title: 'Created by A' });
      expect(respB.newCursor).toBe('1');
    });

    it('should handle empty cursor string as initial sync', () => {
      const server = new SyncServer();

      server.seedEntity('tasks', makeEntity({ id: 'e1' }));

      const result = server.handleSyncRequest({
        cursor: '',
        mutations: [],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      // Empty cursor should be treated as '0' → gets all changes
      expect(response.changes).toHaveLength(1);
    });
  });

  // --- Entity revision tracking ---

  describe('entity revision tracking', () => {
    it('should use separate server sequences from entity revisions (INV-6)', () => {
      const server = new SyncServer();

      // Create entity e1 (server seq 1, entity rev 1)
      server.handleSyncRequest({
        cursor: '0',
        mutations: [
          makeMutation({
            id: 'mut-1',
            entityId: 'e1',
            baseRevision: 0,
            value: { v: 1 },
          }),
        ],
        clientId: 'client-001',
      });

      // Create entity e2 (server seq 2, entity rev 1)
      server.handleSyncRequest({
        cursor: '1',
        mutations: [
          makeMutation({
            id: 'mut-2',
            entityId: 'e2',
            baseRevision: 0,
            value: { v: 1 },
          }),
        ],
        clientId: 'client-001',
      });

      // Update e1 (server seq 3, entity rev 2)
      const result = server.handleSyncRequest({
        cursor: '2',
        mutations: [
          makeMutation({
            id: 'mut-3',
            entityId: 'e1',
            baseRevision: 1,
            operation: 'patch',
            value: { v: 2 },
          }),
        ],
        clientId: 'client-001',
      });

      expect(isSyncResponse(result)).toBe(true);
      const response = result as SyncResponse;
      const change = response.changes[0];
      expect(change).toBeDefined();
      expect(change?.serverSequence).toBe(3);
      expect(change?.entity.revision).toBe(2);
      // Server sequence (3) != entity revision (2) — they are separate (INV-6)
      expect(change?.serverSequence).not.toBe(change?.entity.revision);
    });
  });
});
