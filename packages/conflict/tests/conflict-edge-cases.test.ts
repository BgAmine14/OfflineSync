/**
 * Edge-case tests for conflict resolution strategies.
 *
 * These tests cover boundary conditions that the happy-path tests
 * do not exercise: null/undefined data, missing fields, non-numeric
 * values for increment/decrement, empty arrays, nested objects,
 * and other edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  FieldMergeStrategy,
  RESOLUTION_OUTCOME,
} from '../src/index.js';
import type { ConflictContext } from '../src/index.js';

const ts = '2026-08-14T10:00:00Z';
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
        revision: 2,
        createdAt: ts,
        updatedAt: ts,
        isDeleted: false,
      },
    },
    localMutation: {
      id: 'mut-1',
      operation: 'set',
      field: null,
      value: { title: 'Client Title', count: 5 },
      createdAt: ts,
    },
    localEntity: {
      id: 'entity-1',
      data: { title: 'Client Title', count: 5 },
      revision: 1,
      createdAt: ts,
      updatedAt: ts,
      isDeleted: false,
    },
    serverEntity: {
      id: 'entity-1',
      data: { title: 'Server Title', count: 10 },
      revision: 2,
      createdAt: ts,
      updatedAt: ts,
      isDeleted: false,
    },
    collectionName: 'tasks',
  };

  if (overrides === undefined) return base;

  const merged = { ...base, ...overrides };
  if (overrides.conflict !== undefined) {
    merged.serverEntity = overrides.conflict.serverEntity;
  }
  return merged;
}

describe('Edge cases: null/undefined data', () => {
  describe('ServerWinsStrategy', () => {
    it('should handle null server entity data', () => {
      const strategy = new ServerWinsStrategy();
      const result = strategy.resolve(makeContext({
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: null, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolved).toBe(true);
      expect(result.resolvedData).toBeNull();
    });

    it('should handle undefined local entity', () => {
      const strategy = new ServerWinsStrategy();
      const result = strategy.resolve(makeContext({
        localEntity: undefined,
      }));

      expect(result.resolved).toBe(true);
      expect(result.resolvedData).toEqual({ title: 'Server Title', count: 10 });
    });
  });

  describe('ClientWinsStrategy', () => {
    it('should use mutation value when local entity is undefined and operation is set', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localEntity: undefined,
        localMutation: {
          id: 'mut-1', operation: 'set', field: null,
          value: { title: 'From Mutation' }, createdAt: ts,
        },
      }));

      expect(result.resolvedData).toEqual({ title: 'From Mutation' });
    });

    it('should handle null server data with patch operation', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'patch', field: null,
          value: { count: 20 }, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: null, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      // When serverData is null, mergeDeep starts from {}
      expect(result.resolved).toBe(true);
      expect(result.resolvedData).toEqual({ count: 20 });
    });

    it('should fall back to local entity data for unknown operation', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'unknown-op', field: null,
          value: { x: 1 }, createdAt: ts,
        },
      }));

      expect(result.resolved).toBe(true);
      expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
      expect(result.resolvedData).toEqual({ title: 'Client Title', count: 5 });
    });
  });
});

describe('Edge cases: non-numeric values for increment/decrement', () => {
  describe('FieldMergeStrategy', () => {
    it('should default to 0 when field is missing for increment', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'increment', field: 'nonExistent',
          value: 5, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { otherField: 'hello' }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({
        otherField: 'hello',
        nonExistent: 5,
      });
    });

    it('should default to 0 when field is non-numeric for increment', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'increment', field: 'name',
          value: 5, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { name: 'not a number' }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({ name: 5 });
    });

    it('should default to 0 when field is non-numeric for decrement', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'decrement', field: 'label',
          value: 3, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { label: 'text' }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({ label: -3 });
    });

    it('should handle non-numeric value for increment', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'increment', field: 'count',
          value: 'not a number', createdAt: ts,
        },
      }));

      // value is 'not a number' → NaN, but value is coerced: "not a number" → 0
      expect(result.resolvedData).toEqual({
        title: 'Server Title',
        count: 10, // current + 0 = 10
      });
    });
  });

  describe('ClientWinsStrategy', () => {
    it('should handle increment on non-object server data', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'increment', field: 'count',
          value: 5, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: 'just a string', revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      // Server data is a string, not an object — starts from {}
      expect(result.resolvedData).toEqual({ count: 5 });
    });
  });
});

describe('Edge cases: array operations', () => {
  describe('FieldMergeStrategy', () => {
    it('should create new array when field does not exist for add', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'add', field: 'tags',
          value: 'new-tag', createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { title: 'No Tags' }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({
        title: 'No Tags',
        tags: ['new-tag'],
      });
    });

    it('should create new array when field is not an array for add', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'add', field: 'count',
          value: 'item', createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { count: 42 }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      // count is a number, not array → starts fresh
      expect(result.resolvedData).toEqual({
        count: ['item'],
      });
    });

    it('should handle remove on non-existent array', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'remove', field: 'tags',
          value: 'x', createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { title: 'No Tags' }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({
        title: 'No Tags',
        tags: [],
      });
    });

    it('should not remove items not in the array', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'remove', field: 'items',
          value: 'non-existent', createdAt: ts,
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

    it('should remove all occurrences of a duplicate value', () => {
      const strategy = new FieldMergeStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'remove', field: 'items',
          value: 'dup', createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { items: ['a', 'dup', 'b', 'dup'] }, revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({ items: ['a', 'b'] });
    });
  });
});

describe('Edge cases: deep merge', () => {
  describe('ClientWinsStrategy', () => {
    it('should replace arrays during patch (not concatenate)', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'patch', field: null,
          value: { tags: ['x'] }, createdAt: ts,
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

      // Arrays are replaced, not merged
      expect(result.resolvedData).toEqual({ tags: ['x'] });
    });

    it('should deeply merge nested objects', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'patch', field: null,
          value: { meta: { nested: { deep: 'value' } } }, createdAt: ts,
        },
        conflict: {
          mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
          clientRevision: 1, serverRevision: 2,
          serverEntity: {
            id: 'e1',
            data: { title: 'T', meta: { status: 'active', nested: { existing: 1 } } },
            revision: 2,
            createdAt: ts, updatedAt: ts, isDeleted: false,
          },
        },
      }));

      expect(result.resolvedData).toEqual({
        title: 'T',
        meta: {
          status: 'active',
          nested: { existing: 1, deep: 'value' },
        },
      });
    });

    it('should handle null values in patch', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'patch', field: null,
          value: { title: null }, createdAt: ts,
        },
      }));

      // null is a valid value — it should be set
      expect(result.resolvedData).toEqual({
        title: null,
        count: 10,
      });
    });

    it('should handle empty patch object', () => {
      const strategy = new ClientWinsStrategy();
      const result = strategy.resolve(makeContext({
        localMutation: {
          id: 'mut-1', operation: 'patch', field: null,
          value: {}, createdAt: ts,
        },
      }));

      expect(result.resolvedData).toEqual({
        title: 'Server Title',
        count: 10,
      });
    });
  });
});

describe('Edge cases: LastWriteWinsStrategy timestamps', () => {
  it('should pick server when timestamps are equal', () => {
    const strategy = new LastWriteWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { title: 'Client' }, createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { title: 'Server' }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    }));

    // Equal timestamps → server wins (not >)
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });

  it('should handle invalid timestamp in local mutation gracefully', () => {
    const strategy = new LastWriteWinsStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { title: 'Client' }, createdAt: 'not-a-date',
      },
    }));

    // NaN < any number → server wins
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });

  it('should handle invalid timestamp in server entity gracefully', () => {
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
          createdAt: 'not-a-date', updatedAt: 'not-a-date', isDeleted: false,
        },
      },
    }));

    // Server NaN → neither > is true, so server wins (localTime > serverTime is false)
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });
});

describe('Edge cases: FieldMergeStrategy routing', () => {
  it('should route unknown operations to fallback', () => {
    const fallback = {
      resolve: () => ({
        resolved: true,
        outcome: 'CUSTOM' as const,
        resolvedData: { from: 'fallback' },
      }),
    };
    const strategy = new FieldMergeStrategy(fallback);
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { x: 1 }, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe('CUSTOM');
    expect(result.resolvedData).toEqual({ from: 'fallback' });
  });

  it('should use default ServerWins fallback for set with no custom fallback', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { x: 1 }, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });

  it('should handle increment with negative value', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'increment', field: 'count',
        value: -3, createdAt: ts,
      },
    }));

    expect(result.resolvedData).toEqual({
      title: 'Server Title',
      count: 7, // 10 + (-3) = 7
    });
  });

  it('should handle decrement with negative value (effectively increment)', () => {
    const strategy = new FieldMergeStrategy();
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'decrement', field: 'count',
        value: -5, createdAt: ts,
      },
    }));

    expect(result.resolvedData).toEqual({
      title: 'Server Title',
      count: 15, // 10 - (-5) = 15
    });
  });
});

describe('Edge cases: immutability', () => {
  it('should not mutate the input server entity data', () => {
    const strategy = new ClientWinsStrategy();
    const serverData = { title: 'Original', count: 10 };
    const context = makeContext({
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: serverData, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
      localMutation: {
        id: 'mut-1', operation: 'patch', field: null,
        value: { count: 20 }, createdAt: ts,
      },
    });

    strategy.resolve(context);

    // Server data must not be mutated
    expect(serverData).toEqual({ title: 'Original', count: 10 });
  });

  it('should not mutate the input local entity data', () => {
    const strategy = new FieldMergeStrategy();
    const localData = { tags: ['a', 'b'], count: 5 };
    const context = makeContext({
      localEntity: {
        id: 'e1', data: localData, revision: 1,
        createdAt: ts, updatedAt: ts, isDeleted: false,
      },
      localMutation: {
        id: 'mut-1', operation: 'add', field: 'tags',
        value: 'c', createdAt: ts,
      },
      conflict: {
        mutationId: 'mut-1', entityId: 'e1', collectionName: 't',
        clientRevision: 1, serverRevision: 2,
        serverEntity: {
          id: 'e1', data: { tags: ['a', 'b'], count: 5 }, revision: 2,
          createdAt: ts, updatedAt: ts, isDeleted: false,
        },
      },
    });

    strategy.resolve(context);

    // Local data must not be mutated
    expect(localData).toEqual({ tags: ['a', 'b'], count: 5 });
  });
});
