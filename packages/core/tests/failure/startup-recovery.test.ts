/**
 * Failure simulation tests for crash recovery scenarios.
 *
 * These tests verify that the system recovers correctly
 * from various crash scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RecoveryManager } from '../../src/recovery-manager.js';
import { IntegrityChecker } from '../../src/integrity-checker.js';
import { InMemoryStorageAdapter } from '../../../storage/tests/in-memory-storage-adapter.js';
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

function createAppEntity(id: string): Entity<{ title: string }> {
  return {
    id,
    data: { title: 'Test' },
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };
}

describe('Failure Simulation', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  // ----------------------------------------------------------------
  // Scenario 1: Process crash during write (INV-8)
  // ----------------------------------------------------------------
  describe('scenario 1: process crash during write', () => {
    it('should detect partial write when entity missing for pending mutation', async () => {
      // Arrange — simulate crash after mutation write but before entity write
      const mutation = createMutationEntity('mut-crash-1', {
        status: 'PENDING',
        entityId: 'crashed-entity',
      });
      await storage.put('__mutations__', mutation);

      // Act — integrity check detects the issue
      const checker = new IntegrityChecker({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv8Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-8',
      );
      expect(inv8Issues).toHaveLength(1);
      expect(inv8Issues[0]?.entityId).toBe('crashed-entity');
    });

    it('should preserve pending mutations after simulated crash', async () => {
      // Arrange
      const mutation1 = createMutationEntity('mut-preserve-1', {
        status: 'PENDING',
        sequence: 1,
      });
      const mutation2 = createMutationEntity('mut-preserve-2', {
        status: 'PENDING',
        sequence: 2,
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act — recovery should not lose mutations (INV-4)
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const recoveryResult = await recovery.recover();

      // Assert
      expect(recoveryResult.repaired).toBe(false);
      const stored1 = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-preserve-1',
      );
      expect(stored1.data.status).toBe('PENDING');
      const stored2 = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-preserve-2',
      );
      expect(stored2.data.status).toBe('PENDING');
    });
  });

  // ----------------------------------------------------------------
  // Scenario 2: Process crash during sync (INV-3)
  // ----------------------------------------------------------------
  describe('scenario 2: process crash during sync', () => {
    it('should reset IN_FLIGHT mutations after crash during sync', async () => {
      // Arrange
      const inFlightMutation = createMutationEntity('mut-sync-crash', {
        status: 'IN_FLIGHT',
        sequence: 5,
      });
      await storage.put('__mutations__', inFlightMutation);

      // Act
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await recovery.recover();

      // Assert
      expect(result.repaired).toBe(true);
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-sync-crash',
      );
      expect(stored.data.status).toBe('PENDING');
    });

    it('should reset multiple IN_FLIGHT mutations from batch sync', async () => {
      // Arrange
      for (let index = 1; index <= 5; index++) {
        const mutation = createMutationEntity(`mut-batch-${index}`, {
          status: 'IN_FLIGHT',
          sequence: index,
          entityId: `entity-${index}`,
        });
        await storage.put('__mutations__', mutation);
      }

      // Act
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await recovery.recover();

      // Assert
      expect(result.repairs).toHaveLength(5);
      for (let index = 1; index <= 5; index++) {
        const stored = await storage.get<TestMutationRecord>(
          '__mutations__',
          `mut-batch-${index}`,
        );
        expect(stored.data.status).toBe('PENDING');
      }
    });
  });

  // ----------------------------------------------------------------
  // Scenario 3: Network loss during sync (INV-4)
  // ----------------------------------------------------------------
  describe('scenario 3: network loss during sync', () => {
    it('should preserve all pending mutations when network is lost', async () => {
      // Arrange
      for (let index = 1; index <= 10; index++) {
        const entity = createAppEntity(`entity-${index}`);
        await storage.put('tasks', entity);

        const mutation = createMutationEntity(`mut-net-${index}`, {
          status: 'PENDING',
          sequence: index,
          entityId: `entity-${index}`,
        });
        await storage.put('__mutations__', mutation);
      }

      // Act
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await recovery.recover();

      // Assert — all 10 mutations preserved (INV-4)
      expect(result.repaired).toBe(false);
      for (let index = 1; index <= 10; index++) {
        const stored = await storage.get<TestMutationRecord>(
          '__mutations__',
          `mut-net-${index}`,
        );
        expect(stored.data.status).toBe('PENDING');
      }
    });
  });

  // ----------------------------------------------------------------
  // Scenario 4: Storage full (INV-4)
  // ----------------------------------------------------------------
  describe('scenario 4: storage full', () => {
    it('should report pending mutations that could not be stored', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-storage-full', {
        status: 'FAILED',
        lastError: 'DISK_FULL',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await recovery.recover();

      // Assert — FAILED mutation preserved
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-storage-full',
      );
      expect(stored.data.status).toBe('FAILED');
      expect(stored.data.lastError).toBe('DISK_FULL');
      expect(result.repaired).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Scenario 5: Concurrent writes to same entity (INV-7)
  // ----------------------------------------------------------------
  describe('scenario 5: concurrent writes to same entity', () => {
    it('should preserve multiple pending mutations for same entity in order', async () => {
      // Arrange
      const entity = createAppEntity('shared-entity');
      await storage.put('tasks', entity);

      const mutation1 = createMutationEntity('mut-concurrent-1', {
        status: 'PENDING',
        sequence: 1,
        entityId: 'shared-entity',
      });
      const mutation2 = createMutationEntity('mut-concurrent-2', {
        status: 'PENDING',
        sequence: 2,
        entityId: 'shared-entity',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act
      const checker = new IntegrityChecker({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await checker.check();

      // Assert — sequences are monotonic (INV-1)
      const inv1Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-1',
      );
      expect(inv1Issues).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Scenario 6: Server returns unexpected error (INV-9)
  // ----------------------------------------------------------------
  describe('scenario 6: server returns unexpected error', () => {
    it('should preserve mutation with server error info', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-server-error', {
        status: 'FAILED',
        lastError: 'INTERNAL_SERVER_ERROR: unexpected null pointer',
        retries: 3,
      });
      await storage.put('__mutations__', mutation);

      // Act
      const recovery = new RecoveryManager({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await recovery.recover();

      // Assert (INV-4)
      const stored = await storage.get<TestMutationRecord>(
        '__mutations__',
        'mut-server-error',
      );
      expect(stored.data.status).toBe('FAILED');
      expect(stored.data.lastError).toContain('INTERNAL_SERVER_ERROR');
      expect(stored.data.retries).toBe(3);
      expect(result.repaired).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Scenario 7: Storage corruption detection (INV-4)
  // ----------------------------------------------------------------
  describe('scenario 7: storage corruption detection', () => {
    it('should detect mutation with unknown status as corruption', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-corrupt', {
        status: 'CORRUPTED_STATUS',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const checker = new IntegrityChecker({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv4Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-4',
      );
      expect(inv4Issues.length).toBeGreaterThan(0);
    });

    it('should detect sequence integrity violation', async () => {
      // Arrange
      const m1 = createMutationEntity('m1', {
        sequence: 10,
        status: 'ACKNOWLEDGED',
      });
      const m2 = createMutationEntity('m2', {
        sequence: 5,
        status: 'ACKNOWLEDGED',
        entityId: 'e2',
      });
      await storage.put('__mutations__', m1);
      await storage.put('__mutations__', m2);

      // Act
      const checker = new IntegrityChecker({
        storage,
        applicationCollections: ['tasks'],
      });
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv1Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-1',
      );
      expect(inv1Issues.length).toBeGreaterThan(0);
    });
  });
});
