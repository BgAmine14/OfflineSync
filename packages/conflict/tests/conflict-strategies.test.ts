import { describe, it, expect } from 'vitest';
import {
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  ManualStrategy,
  FieldMergeStrategy,
  RESOLUTION_OUTCOME,
} from '../src/index.js';
import type { ConflictContext } from '../src/index.js';

const ts = '2026-08-14T10:00:00Z';
const tsOlder = '2026-08-14T09:00:00Z';
const tsNewer = '2026-08-14T11:00:00Z';

function makeContext(overrides?: Partial<ConflictContext>): ConflictContext {
  const base: ConflictContext = {
    conflict: {
      mutationId: 'mut-1',
      entityId: 'entity-1',
      collectionName: 'tasks',
      clientRevision: 1,
      serverRevision: 2,
      serverEntity: {
        id: 'entity-1',
        data: { title: 'Server Title', count: 10 },
        revision: 2, createdAt: ts, updatedAt: ts, isDeleted: false,
      },
    },
    localMutation: {
      id: 'mut-1', operation: 'set', field: null,
      value: { title: 'Client Title', count: 5 }, createdAt: ts,
    },
    localEntity: {
      id: 'entity-1', data: { title: 'Client Title', count: 5 },
      revision: 1, createdAt: ts, updatedAt: ts, isDeleted: false,
    },
    serverEntity: {
      id: 'entity-1',
      data: { title: 'Server Title', count: 10 },
      revision: 2, createdAt: ts, updatedAt: ts, isDeleted: false,
    },
    collectionName: 'tasks',
  };

  if (overrides === undefined) return base;

  const merged = { ...base, ...overrides };
  // Keep top-level serverEntity in sync with conflict.serverEntity
  if (overrides.conflict !== undefined) {
    merged.serverEntity = overrides.conflict.serverEntity;
  }
  return merged;
}

describe('ServerWinsStrategy', () => {
  it('should return server data', () => {
    const strategy = new ServerWinsStrategy();
    const result = strategy.resolve(makeContext());

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 10 });
  });
});

describe('ClientWinsStrategy', () => {
  it('should return local data for set operations', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext());

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
    expect(result.resolvedData).toEqual({ title: 'Client Title', count: 5 });
  });

  it('should merge patch on top of server data', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'patch', field: null,
        value: { count: 20 }, createdAt: ts,
      },
    }));

    expect(result.resolved).toBe(true);
    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 20 });
  });

  it('should apply increment on a field', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'increment', field: 'count',
        value: 3, createdAt: ts,
      },
    }));

    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 13 });
  });

  it('should apply decrement on a field', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'decrement', field: 'count',
        value: 3, createdAt: ts,
      },
    }));

    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 7 });
  });

  it('should handle add to array', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'add', field: 'tags',
        value: 'important', createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { tags: ['a', 'b'] }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    expect(result.resolvedData).toEqual({ tags: ['a', 'b', 'important'] });
  });

  it('should handle remove from array', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'remove', field: 'tags',
        value: 'b', createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { tags: ['a', 'b', 'c'] }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    expect(result.resolvedData).toEqual({ tags: ['a', 'c'] });
  });
});

describe('LastWriteWinsStrategy', () => {
  it('should pick client when mutation is newer', () => {
    const strategy = new LastWriteWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { title: 'Client' }, createdAt: tsNewer,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { title: 'Server' }, revision: 2,
          createdAt: tsOlder, updatedAt: tsOlder, isDeleted: false,
        },
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
  });

  it('should pick server when entity is newer', () => {
    const strategy = new LastWriteWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { title: 'Client' }, createdAt: tsOlder,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { title: 'Server' }, revision: 2,
          createdAt: tsNewer, updatedAt: tsNewer, isDeleted: false,
        },
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });
});

describe('ManualStrategy', () => {
  it('should never auto-resolve', () => {
    const strategy = new ManualStrategy();
    const result = strategy.resolve(makeContext());

    expect(result.resolved).toBe(false);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MANUAL);
  });
});

describe('FieldMergeStrategy', () => {
  it('should merge increment on server data', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'increment', field: 'count',
        value: 5, createdAt: ts,
      },
    }));

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MERGED);
    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 15 });
  });

  it('should use fallback for set operations (non-commutative)', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext());

    // Default fallback is ServerWins
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
    expect(result.resolvedData).toEqual({ title: 'Server Title', count: 10 });
  });

  it('should use custom fallback for set operations', () => {
    const fallback = { resolve: () => ({ resolved: true, outcome: 'CLIENT_WINS' as const, resolvedData: { custom: true } }) };
    const strategy = new FieldMergeStrategy(fallback);
    const result = strategy.resolve(makeContext());

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
    expect(result.resolvedData).toEqual({ custom: true });
  });

  it('should merge add to array on server data', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'add', field: 'items',
        value: 'c', createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { items: ['a', 'b'] }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    expect(result.resolvedData).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('should not duplicate items on add', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'add', field: 'items',
        value: 'a', createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { items: ['a', 'b'] }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    expect(result.resolvedData).toEqual({ items: ['a', 'b'] });
  });
});

describe('deep merge (patch)', () => {
  it('should deep merge nested objects', () => {
    const strategy = new ClientWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'patch', field: null,
        value: { meta: { priority: 'high' } }, createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { title: 'T', meta: { status: 'active' } },
          revision: 2, createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    expect(result.resolvedData).toEqual({
      title: 'T',
      meta: { status: 'active', priority: 'high' },
    });
  });
});
