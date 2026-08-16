/**
 * Tests for RecoveryManager — startup recovery after crashes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RecoveryManager } from '../src/recovery-manager.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import type { Entity } from '@offlinesync/storage';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

interface TestMutationRecord {
  readonly entityId: string;
  readonly collectionName: string;
  readonly operation: string;
  readonly field: string | null;
  readonly value: unknown;
  readonly sequence: number;
  readonly status: string;
  readonly createdAt: string;
  readonly retries: number;
  readonly lastError: string | null;
}

function createMutationEntity(
  id: string,
  overrides: Partial<TestMutationRecord> = {},
): Entity<TestMutationRecord> {
  return {
    id,
    data: {
      entityId: 'entity-1',
      collectionName: 'tasks',
      operation: 'set',
      field: null,
      value: { title: 'Test' },
      sequence: 1,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      retries: 0,
      lastError: null,
      ...overrides,
    },
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };
}

describe('RecoveryManager', () => {
  let storage: InMemoryStorageAdapter;
  let manager: RecoveryManager;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    manager = new RecoveryManager({
      storage,
      applicationCollections: ['tasks', 'projects'],
    });
  });

  describe('recover', () => {
    it('should return empty result when no mutations exist', async () => {
      // Arrange
      // No mutations in storage

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(false);
      expect(result.repairs).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should not modify PENDING mutations', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', { status: 'PENDING' });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(false);
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored.data.status).toBe('PENDING');
    });

    it('should not modify ACKNOWLEDGED mutations', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'ACKNOWLEDGED',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(false);
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored.data.status).toBe('ACKNOWLEDGED');
    });

    it('should not modify FAILED mutations', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'FAILED',
        lastError: 'Network timeout',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(false);
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored.data.status).toBe('FAILED');
    });
  });

  describe('resetInFlightMutations', () => {
    it('should reset IN_FLIGHT mutations to PENDING', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', { status: 'IN_FLIGHT' });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(true);
      expect(result.repairs).toHaveLength(1);
      expect(result.repairs[0]?.invariant).toBe('INV-4');
      expect(result.repairs[0]?.description).toContain('IN_FLIGHT');
      expect(result.repairs[0]?.description).toContain('PENDING');

      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored.data.status).toBe('PENDING');
    });

    it('should reset multiple IN_FLIGHT mutations', async () => {
      // Arrange
      const mutation1 = createMutationEntity('mut-1', {
        status: 'IN_FLIGHT',
        sequence: 1,
      });
      const mutation2 = createMutationEntity('mut-2', {
        status: 'IN_FLIGHT',
        sequence: 2,
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act
      const result = await manager.recover();

      // Assert
      expect(result.repaired).toBe(true);
      expect(result.repairs).toHaveLength(2);

      const stored1 = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored1.data.status).toBe('PENDING');

      const stored2 = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-2',
      );
      expect(stored2.data.status).toBe('PENDING');
    });

    it('should increment revision when resetting status', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'IN_FLIGHT',
      });
      await storage.put('__mutations__', mutation);

      // Act
      await manager.recover();

      // Assert
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-1',
      );
      expect(stored.revision).toBe(2);
    });
  });

  describe('checkSequenceIntegrity', () => {
    it('should not warn when sequences are contiguous', async () => {
      // Arrange
      const mutation1 = createMutationEntity('mut-1', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
      });
      const mutation2 = createMutationEntity('mut-2', {
        sequence: 2,
        status: 'ACKNOWLEDGED',
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act
      const result = await manager.recover();

      // Assert
      const sequenceWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-1',
      );
      expect(sequenceWarnings).toHaveLength(0);
    });

    it('should warn when there is a sequence gap', async () => {
      // Arrange
      const mutation1 = createMutationEntity('mut-1', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
      });
      const mutation3 = createMutationEntity('mut-3', {
        sequence: 5,
        status: 'ACKNOWLEDGED',
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation3);

      // Act
      const result = await manager.recover();

      // Assert
      const sequenceWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-1',
      );
      expect(sequenceWarnings).toHaveLength(1);
      expect(sequenceWarnings[0]?.severity).toBe('high');
      expect(sequenceWarnings[0]?.description).toContain('gap');
    });
  });

  describe('checkOrphanedMutations', () => {
    it('should not warn when entity exists for pending mutation', async () => {
      // Arrange
      const entity = {
        id: 'entity-1',
        data: { title: 'Test' },
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };
      await storage.put('tasks', entity);

      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
        entityId: 'entity-1',
        collectionName: 'tasks',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      const orphanWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-4',
      );
      expect(orphanWarnings).toHaveLength(0);
    });

    it('should warn when entity is missing for pending mutation', async () => {
      // Arrange — no entity in 'tasks' collection
      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
        entityId: 'missing-entity',
        collectionName: 'tasks',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      const orphanWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-4',
      );
      expect(orphanWarnings).toHaveLength(1);
      expect(orphanWarnings[0]?.severity).toBe('medium');
      expect(orphanWarnings[0]?.description).toContain('missing-entity');
    });

    it('should skip mutations for system collections', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
        collectionName: '__mutations__',
        entityId: 'non-existent',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      const orphanWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-4',
      );
      expect(orphanWarnings).toHaveLength(0);
    });

    it('should skip mutations for unknown collections', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
        collectionName: 'unknown-collection',
        entityId: 'non-existent',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await manager.recover();

      // Assert
      const orphanWarnings = result.warnings.filter(
        (warning) => warning.invariant === 'INV-4',
      );
      expect(orphanWarnings).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('should produce same result when run multiple times', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', { status: 'IN_FLIGHT' });
      await storage.put('__mutations__', mutation);

      // Act
      const result1 = await manager.recover();
      const result2 = await manager.recover();

      // Assert
      expect(result1.repaired).toBe(true);
      expect(result1.repairs).toHaveLength(1);
      expect(result2.repaired).toBe(false);
      expect(result2.repairs).toHaveLength(0);
    });
  });
});
