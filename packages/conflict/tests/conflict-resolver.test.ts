import { describe, it, expect } from 'vitest';
import {
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
} from '../src/index.js';
import type { ConflictContext, ConflictResolver } from '../src/index.js';

const ts = '2026-08-14T10:00:00Z';

function makeContext(
  collectionName = 'tasks',
): ConflictContext {
  return {
    conflict: {
      mutationId: 'mut-1',
      entityId: 'e1',
      collectionName,
      clientRevision: 1,
      serverRevision: 2,
      serverEntity: {
        id: 'e1', data: { v: 'server' }, revision: 2,
        createdAt: ts, updatedAt: ts, isDeleted: false,
      },
    },
    localMutation: {
      id: 'mut-1', operation: 'set', field: null,
      value: { v: 'client' }, createdAt: ts,
    },
    localEntity: {
      id: 'e1', data: { v: 'client' }, revision: 1,
      createdAt: ts, updatedAt: ts, isDeleted: false,
    },
    serverEntity: {
      id: 'e1', data: { v: 'server' }, revision: 2,
      createdAt: ts, updatedAt: ts, isDeleted: false,
    },
    collectionName,
  };
}

describe('ConflictResolutionManager', () => {
  it('should use default strategy (LAST_WRITE_WINS)', () => {
    const manager = new ConflictResolutionManager();
    const result = manager.resolve(makeContext());
    expect(result.resolved).toBe(true);
  });

  it('should use per-collection strategy', () => {
    const manager = new ConflictResolutionManager({
      defaultStrategy: BUILT_IN_STRATEGY.LAST_WRITE_WINS,
      collectionStrategies: {
        'transactions': BUILT_IN_STRATEGY.MANUAL,
      },
    });

    // Default collection uses LWW (resolved)
    const tasksResult = manager.resolve(makeContext('tasks'));
    expect(tasksResult.resolved).toBe(true);

    // Override collection uses MANUAL (not resolved)
    const txResult = manager.resolve(makeContext('transactions'));
    expect(txResult.resolved).toBe(false);
    expect(txResult.outcome).toBe('MANUAL');
  });

  it('should use custom resolver instance', () => {
    const customResolver: ConflictResolver = {
      resolve: () => ({ resolved: true, outcome: 'CLIENT_WINS', resolvedData: { from: 'custom' } }),
    };
    const manager = new ConflictResolutionManager({
      defaultStrategy: customResolver,
    });

    const result = manager.resolve(makeContext());
    expect(result.resolvedData).toEqual({ from: 'custom' });
  });

  it('should try fallback chain when primary does not resolve', () => {
    const manager = new ConflictResolutionManager({
      defaultStrategy: BUILT_IN_STRATEGY.MANUAL,
      fallbackChain: [
        BUILT_IN_STRATEGY.MANUAL,
        BUILT_IN_STRATEGY.SERVER_WINS,
      ],
    });

    const result = manager.resolve(makeContext());
    // First fallback (MANUAL) doesn't resolve, second (SERVER_WINS) does
    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe('SERVER_WINS');
  });

  it('should allow runtime collection strategy changes', () => {
    const manager = new ConflictResolutionManager({
      defaultStrategy: BUILT_IN_STRATEGY.LAST_WRITE_WINS,
    });

    // Initially resolves
    expect(manager.resolve(makeContext('logs')).resolved).toBe(true);

    // Set to manual
    manager.setCollectionStrategy('logs', BUILT_IN_STRATEGY.MANUAL);
    expect(manager.resolve(makeContext('logs')).resolved).toBe(false);
  });

  it('should support all built-in strategy names', () => {
    expect(BUILT_IN_STRATEGY.SERVER_WINS).toBe('SERVER_WINS');
    expect(BUILT_IN_STRATEGY.CLIENT_WINS).toBe('CLIENT_WINS');
    expect(BUILT_IN_STRATEGY.LAST_WRITE_WINS).toBe('LAST_WRITE_WINS');
    expect(BUILT_IN_STRATEGY.MANUAL).toBe('MANUAL');
    expect(BUILT_IN_STRATEGY.FIELD_MERGE).toBe('FIELD_MERGE');
  });
});
