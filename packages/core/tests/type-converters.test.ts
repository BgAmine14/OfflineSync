import { describe, it, expect } from 'vitest';
import {
  clientMutationToProtocol,
  buildSyncRequest,
  protocolEntityToClient,
  extractAcknowledgedIds,
  extractConflictIds,
  extractEntitiesFromChanges,
  extractEntitiesFromSnapshot,
} from '../src/type-converters.js';
import type { Mutation } from '../src/types/index.js';
import type {
  SyncResponse,
  SnapshotResponse,
} from '@offlinesync/protocol';

const validTimestamp = '2026-08-14T10:00:00Z';

function makeMutation(overrides?: Partial<Mutation>): Mutation {
  return {
    id: 'mut-001',
    entityId: 'entity-001',
    collectionName: 'tasks',
    operation: 'set',
    field: null,
    value: { title: 'Buy milk' },
    sequence: 1,
    status: 'PENDING',
    createdAt: validTimestamp,
    retries: 0,
    lastError: null,
    ...overrides,
  };
}

// ============================================================
// clientMutationToProtocol
// ============================================================

describe('clientMutationToProtocol', () => {
  it('should strip internal fields from client mutation', () => {
    const mutation = makeMutation();
    const proto = clientMutationToProtocol(mutation, 3);

    expect(proto.id).toBe('mut-001');
    expect(proto.entityId).toBe('entity-001');
    expect(proto.collectionName).toBe('tasks');
    expect(proto.operation).toBe('set');
    expect(proto.field).toBeNull();
    expect(proto.value).toEqual({ title: 'Buy milk' });
    expect(proto.baseRevision).toBe(3);
    expect(proto.createdAt).toBe(validTimestamp);
  });

  it('should not include sequence, status, retries, or lastError', () => {
    const mutation = makeMutation();
    const proto = clientMutationToProtocol(mutation, 1);

    expect('sequence' in proto).toBe(false);
    expect('status' in proto).toBe(false);
    expect('retries' in proto).toBe(false);
    expect('lastError' in proto).toBe(false);
  });

  it('should use provided baseRevision', () => {
    const proto = clientMutationToProtocol(makeMutation(), 42);
    expect(proto.baseRevision).toBe(42);
  });
});

// ============================================================
// buildSyncRequest
// ============================================================

describe('buildSyncRequest', () => {
  it('should build a valid SyncRequest', () => {
    const mutations = [makeMutation()];
    const revisions = new Map<string, number>([['entity-001', 5]]);
    const request = buildSyncRequest('cursor-abc', mutations, revisions, 'client-1');

    expect(request.cursor).toBe('cursor-abc');
    expect(request.clientId).toBe('client-1');
    expect(request.mutations).toHaveLength(1);
    expect(request.mutations[0]?.id).toBe('mut-001');
    expect(request.mutations[0]?.baseRevision).toBe(5);
  });

  it('should use revision 0 when entity has no base revision', () => {
    const mutations = [makeMutation()];
    const revisions = new Map<string, number>();
    const request = buildSyncRequest('', mutations, revisions, 'client-1');

    expect(request.mutations[0]?.baseRevision).toBe(0);
  });

  it('should handle empty mutations array', () => {
    const request = buildSyncRequest('cursor', [], new Map(), 'c');
    expect(request.mutations).toHaveLength(0);
    expect(request.cursor).toBe('cursor');
    expect(request.clientId).toBe('c');
  });
});

// ============================================================
// protocolEntityToClient
// ============================================================

describe('protocolEntityToClient', () => {
  it('should convert a ProtocolEntity to client Entity', () => {
    const proto = {
      id: 'e1',
      data: { title: 'Test' },
      revision: 3,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
      isDeleted: false,
    };

    const entity = protocolEntityToClient<{ title: string }>(proto);

    expect(entity.id).toBe('e1');
    expect(entity.data).toEqual({ title: 'Test' });
    expect(entity.revision).toBe(3);
    expect(entity.createdAt).toBe(validTimestamp);
    expect(entity.updatedAt).toBe(validTimestamp);
    expect(entity.isDeleted).toBe(false);
  });

  it('should cast data to generic type', () => {
    const proto = {
      id: 'e1',
      data: { count: 42 },
      revision: 1,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
      isDeleted: true,
    };

    const entity = protocolEntityToClient<{ count: number }>(proto);
    expect(entity.data.count).toBe(42);
    expect(entity.isDeleted).toBe(true);
  });
});

// ============================================================
// extractAcknowledgedIds
// ============================================================

describe('extractAcknowledgedIds', () => {
  it('should return acknowledged mutation IDs', () => {
    const response: SyncResponse = {
      changes: [],
      acknowledgedMutationIds: ['m1', 'm2'],
      conflicts: [],
      newCursor: 'c1',
    };
    expect(extractAcknowledgedIds(response)).toEqual(['m1', 'm2']);
  });

  it('should return empty array when none acknowledged', () => {
    const response: SyncResponse = {
      changes: [],
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: 'c1',
    };
    expect(extractAcknowledgedIds(response)).toEqual([]);
  });
});

// ============================================================
// extractConflictIds
// ============================================================

describe('extractConflictIds', () => {
  it('should return conflict mutation IDs', () => {
    const response: SyncResponse = {
      changes: [],
      acknowledgedMutationIds: [],
      conflicts: [
        {
          mutationId: 'm1',
          entityId: 'e1',
          collectionName: 'tasks',
          clientRevision: 1,
          serverRevision: 3,
          serverEntity: {
            id: 'e1', data: {}, revision: 3,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        },
      ],
      newCursor: 'c1',
    };
    expect(extractConflictIds(response)).toEqual(['m1']);
  });

  it('should return empty array when no conflicts', () => {
    const response: SyncResponse = {
      changes: [],
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: 'c1',
    };
    expect(extractConflictIds(response)).toEqual([]);
  });
});

// ============================================================
// extractEntitiesFromChanges
// ============================================================

describe('extractEntitiesFromChanges', () => {
  it('should extract entities from changes', () => {
    const response: SyncResponse = {
      changes: [
        {
          serverSequence: 1,
          collectionName: 'tasks',
          entity: {
            id: 'e1', data: { title: 'A' }, revision: 2,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
          operation: 'patch', field: null, value: { title: 'A' },
        },
        {
          serverSequence: 2,
          collectionName: 'tasks',
          entity: {
            id: 'e2', data: { title: 'B' }, revision: 1,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
          operation: 'set', field: null, value: { title: 'B' },
        },
      ],
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: 'c1',
    };

    const entities = extractEntitiesFromChanges<{ title: string }>(response);
    expect(entities).toHaveLength(2);
    expect(entities[0]?.id).toBe('e1');
    expect(entities[0]?.data.title).toBe('A');
    expect(entities[1]?.id).toBe('e2');
  });

  it('should return empty array for no changes', () => {
    const response: SyncResponse = {
      changes: [],
      acknowledgedMutationIds: [],
      conflicts: [],
      newCursor: 'c1',
    };
    const entities = extractEntitiesFromChanges(response);
    expect(entities).toHaveLength(0);
  });
});

// ============================================================
// extractEntitiesFromSnapshot
// ============================================================

describe('extractEntitiesFromSnapshot', () => {
  it('should extract entities grouped by collection', () => {
    const response: SnapshotResponse = {
      entities: {
        tasks: [
          {
            id: 'e1', data: { title: 'A' }, revision: 1,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        ],
        projects: [
          {
            id: 'e2', data: { name: 'P1' }, revision: 1,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        ],
      },
      cursor: 'c1',
      serverTimestamp: validTimestamp,
    };

    const result = extractEntitiesFromSnapshot(response);
    expect(result.size).toBe(2);
    expect(result.get('tasks')).toHaveLength(1);
    expect(result.get('projects')).toHaveLength(1);
    expect(result.get('tasks')?.[0]?.id).toBe('e1');
  });

  it('should return empty map for empty snapshot', () => {
    const response: SnapshotResponse = {
      entities: {},
      cursor: 'c1',
      serverTimestamp: validTimestamp,
    };
    const result = extractEntitiesFromSnapshot(response);
    expect(result.size).toBe(0);
  });
});
