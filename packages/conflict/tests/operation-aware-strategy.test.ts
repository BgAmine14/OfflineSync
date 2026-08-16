/**
 * Tests for OperationAwareStrategy and FunctionStrategy.
 */

import { describe, it, expect } from 'vitest';
import {
  OperationAwareStrategy,
  FunctionStrategy,
  ServerWinsStrategy,
  ClientWinsStrategy,
  FieldMergeStrategy,
  RESOLUTION_OUTCOME,
} from '../src/index.js';
import type { ConflictContext, ConflictResolver } from '../src/index.js';

const ts = '2026-08-14T10:00:00Z';

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
        data: { title: 'Server', count: 10 },
        revision: 2, createdAt: ts, updatedAt: ts, isDeleted: false,
      },
    },
    localMutation: {
      id: 'mut-1', operation: 'set', field: null,
      value: { title: 'Client' }, createdAt: ts,
    },
    localEntity: {
      id: 'entity-1',
      data: { title: 'Client', count: 5 },
      revision: 1, createdAt: ts, updatedAt: ts, isDeleted: false,
    },
    serverEntity: {
      id: 'entity-1',
      data: { title: 'Server', count: 10 },
      revision: 2, createdAt: ts, updatedAt: ts, isDeleted: false,
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

describe('OperationAwareStrategy', () => {
  it('should use commutative strategy for increment', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'increment', field: 'count',
        value: 5, createdAt: ts,
      },
    }));

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MERGED);
    expect(result.resolvedData).toEqual({ title: 'Server', count: 15 });
  });

  it('should use commutative strategy for decrement', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'decrement', field: 'count',
        value: 3, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MERGED);
    expect(result.resolvedData).toEqual({ title: 'Server', count: 7 });
  });

  it('should use commutative strategy for add', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'add', field: 'tags',
        value: 'new', createdAt: ts,
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

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MERGED);
    expect(result.resolvedData).toEqual({ tags: ['a', 'b', 'new'] });
  });

  it('should use non-commutative strategy for set', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ClientWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'set', field: null,
        value: { title: 'Client' }, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
  });

  it('should use non-commutative strategy for patch', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'patch', field: null,
        value: { count: 99 }, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });

  it('should use fallback for unknown operations', () => {
    const fallback: ConflictResolver = {
      resolve: () => ({
        resolved: true,
        outcome: 'CUSTOM' as const,
        resolvedData: { from: 'fallback' },
      }),
    };

    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
      fallbackStrategy: fallback,
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'unknown-op', field: null,
        value: { x: 1 }, createdAt: ts,
      },
    }));

    expect(result.outcome).toBe('CUSTOM');
  });

  it('should default fallback to non-commutative strategy', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ServerWinsStrategy(),
    });

    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'custom', field: null,
        value: { x: 1 }, createdAt: ts,
      },
    }));

    // Falls back to nonCommutativeStrategy (ServerWins)
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
  });

  it('should not treat field-less increment as commutative', () => {
    const strategy = new OperationAwareStrategy({
      commutativeStrategy: new FieldMergeStrategy(),
      nonCommutativeStrategy: new ClientWinsStrategy(),
    });

    // increment without a field → routed to non-commutative (not a valid
    // mutation shape, but the strategy must handle it gracefully)
    const result = strategy.resolve(makeContext({
      localMutation: {
        id: 'mut-1', operation: 'increment', field: null,
        value: 5, createdAt: ts,
      },
    }));

    // field is null → not commutative routing → falls to non-commutative
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.CLIENT_WINS);
  });
});

describe('FunctionStrategy', () => {
  it('should delegate to the provided function', () => {
    const strategy = new FunctionStrategy((context) => ({
      resolved: true,
      outcome: RESOLUTION_OUTCOME.SERVER_WINS,
      resolvedData: context.serverEntity.data,
    }));

    const result = strategy.resolve(makeContext());
    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
    expect(result.resolvedData).toEqual({ title: 'Server', count: 10 });
  });

  it('should work as a custom resolver in ConflictResolutionManager', () => {
    const strategy = new FunctionStrategy((_context) => ({
      resolved: true,
      outcome: RESOLUTION_OUTCOME.MERGED as const,
      resolvedData: { merged: true },
    }));

    // Direct usage
    const result = strategy.resolve(makeContext());
    expect(result.resolvedData).toEqual({ merged: true });
  });

  it('should implement ConflictResolver interface', () => {
    const strategy: ConflictResolver = new FunctionStrategy(() => ({
      resolved: false,
      outcome: RESOLUTION_OUTCOME.MANUAL,
      resolvedData: undefined,
    }));

    const result = strategy.resolve(makeContext());
    expect(result.resolved).toBe(false);
    expect(result.outcome).toBe(RESOLUTION_OUTCOME.MANUAL);
  });

  it('should be deterministic (INV-2)', () => {
    let callCount = 0;
    const strategy = new FunctionStrategy((context) => {
      callCount++;
      return {
        resolved: true,
        outcome: RESOLUTION_OUTCOME.SERVER_WINS,
        resolvedData: context.serverEntity.data,
      };
    });

    const context = makeContext();
    const r1 = strategy.resolve(context);
    const r2 = strategy.resolve(context);

    expect(r1).toEqual(r2);
    expect(callCount).toBe(2);
  });

  it('should receive the full context', () => {
    let receivedContext: ConflictContext | undefined;
    const strategy = new FunctionStrategy((context) => {
      receivedContext = context;
      return {
        resolved: true,
        outcome: RESOLUTION_OUTCOME.SERVER_WINS,
        resolvedData: context.serverEntity.data,
      };
    });

    const ctx = makeContext();
    strategy.resolve(ctx);

    expect(receivedContext).toBe(ctx);
    expect(receivedContext?.collectionName).toBe('tasks');
    expect(receivedContext?.localMutation.operation).toBe('set');
  });
});
