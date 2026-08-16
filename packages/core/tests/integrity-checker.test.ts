/**
 * Tests for IntegrityChecker — storage consistency verification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntegrityChecker } from '../src/integrity-checker.js';
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

function createAppEntity(
  id: string,
  overrides: Partial<Entity<{ title: string }>> = {},
): Entity<{ title: string }> {
  return {
    id,
    data: { title: 'Test' },
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
    ...overrides,
  };
}

describe('IntegrityChecker', () => {
  let storage: InMemoryStorageAdapter;
  let checker: IntegrityChecker;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    checker = new IntegrityChecker({
      storage,
      applicationCollections: ['tasks', 'projects'],
    });
  });

  describe('check', () => {
    it('should return healthy when storage is empty', async () => {
      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.summary.critical).toBe(0);
      expect(result.summary.high).toBe(0);
      expect(result.summary.medium).toBe(0);
      expect(result.summary.low).toBe(0);
    });

    it('should return healthy when all data is consistent', async () => {
      // Arrange
      const entity = createAppEntity('entity-1');
      await storage.put('tasks', entity);

      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('sequence monotonicity (INV-1)', () => {
    it('should detect duplicate sequence numbers', async () => {
      // Arrange
      const mutation1 = createMutationEntity('mut-1', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
      });
      const mutation2 = createMutationEntity('mut-2', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv1Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-1',
      );
      expect(inv1Issues.length).toBeGreaterThan(0);
      const criticalIssues = inv1Issues.filter(
        (issue) => issue.severity === 'critical',
      );
      expect(criticalIssues.length).toBeGreaterThan(0);
    });

    it('should detect sequence gaps', async () => {
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
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const gapIssues = result.issues.filter(
        (issue) =>
          issue.invariant === 'INV-1' && issue.description.includes('gap'),
      );
      expect(gapIssues).toHaveLength(1);
      expect(gapIssues[0]?.severity).toBe('high');
    });

    it('should not flag mutations from different collections', async () => {
      // Arrange — different collections can have overlapping sequences
      const mutation1 = createMutationEntity('mut-1', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
        collectionName: 'tasks',
      });
      const mutation2 = createMutationEntity('mut-2', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
        collectionName: 'projects',
        entityId: 'entity-2',
      });
      await storage.put('__mutations__', mutation1);
      await storage.put('__mutations__', mutation2);

      // Act
      const result = await checker.check();

      // Assert
      const inv1Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-1',
      );
      expect(inv1Issues).toHaveLength(0);
    });
  });

  describe('mutation durability (INV-4)', () => {
    it('should detect mutation with unknown status', async () => {
      // Arrange
      const mutation = createMutationEntity('mut-1', {
        status: 'UNKNOWN_STATUS',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv4Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-4',
      );
      expect(inv4Issues.length).toBeGreaterThan(0);
    });
  });

  describe('atomic write pairs (INV-8)', () => {
    it('should detect pending mutation without entity', async () => {
      // Arrange — mutation exists but entity does not
      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
        entityId: 'missing-entity',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv8Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-8',
      );
      expect(inv8Issues).toHaveLength(1);
      expect(inv8Issues[0]?.severity).toBe('high');
      expect(inv8Issues[0]?.entityId).toBe('missing-entity');
    });

    it('should not flag when entity exists', async () => {
      // Arrange
      const entity = createAppEntity('entity-1');
      await storage.put('tasks', entity);

      const mutation = createMutationEntity('mut-1', {
        status: 'PENDING',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await checker.check();

      // Assert
      const inv8Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-8',
      );
      expect(inv8Issues).toHaveLength(0);
    });

    it('should skip acknowledged mutations even without entity', async () => {
      // Arrange — acknowledged mutations may reference entities
      // that were later deleted by the server
      const mutation = createMutationEntity('mut-1', {
        status: 'ACKNOWLEDGED',
        entityId: 'deleted-entity',
      });
      await storage.put('__mutations__', mutation);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(true);
    });
  });

  describe('revision types (INV-6)', () => {
    it('should detect entity with negative revision', async () => {
      // Arrange
      const entity = createAppEntity('entity-1', { revision: -1 as number });
      await storage.put('tasks', entity as Entity<{ title: string }>);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      const inv6Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-6',
      );
      expect(inv6Issues).toHaveLength(1);
      expect(inv6Issues[0]?.severity).toBe('medium');
    });

    it('should detect entity with non-numeric revision', async () => {
      // Arrange
      const entity = {
        id: 'entity-1',
        data: { title: 'Test' },
        revision: 'not-a-number' as unknown as number,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };
      await storage.put('tasks', entity as Entity<{ title: string }>);

      // Act
      const result = await checker.check();

      // Assert
      const inv6Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-6',
      );
      expect(inv6Issues).toHaveLength(1);
    });

    it('should pass for entities with valid revisions', async () => {
      // Arrange
      const entity = createAppEntity('entity-1', { revision: 42 });
      await storage.put('tasks', entity);

      // Act
      const result = await checker.check();

      // Assert
      const inv6Issues = result.issues.filter(
        (issue) => issue.invariant === 'INV-6',
      );
      expect(inv6Issues).toHaveLength(0);
    });
  });

  describe('summary', () => {
    it('should count issues by severity correctly', async () => {
      // Arrange — create multiple issues of different severities
      // Critical: duplicate sequence (INV-1)
      const m1 = createMutationEntity('m1', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
      });
      const m2 = createMutationEntity('m2', {
        sequence: 1,
        status: 'ACKNOWLEDGED',
        entityId: 'e2',
      });
      await storage.put('__mutations__', m1);
      await storage.put('__mutations__', m2);

      // High: missing entity for pending mutation (INV-8)
      const m3 = createMutationEntity('m3', {
        status: 'PENDING',
        entityId: 'missing',
      });
      await storage.put('__mutations__', m3);

      // Medium: invalid revision (INV-6)
      const entity = createAppEntity('bad-rev', { revision: -1 as number });
      await storage.put('tasks', entity as Entity<{ title: string }>);

      // Act
      const result = await checker.check();

      // Assert
      expect(result.healthy).toBe(false);
      expect(result.summary.critical).toBeGreaterThan(0);
      expect(result.summary.high).toBeGreaterThan(0);
      expect(result.summary.medium).toBeGreaterThan(0);
      expect(result.issues).toHaveLength(
        result.summary.critical +
          result.summary.high +
          result.summary.medium +
          result.summary.low,
      );
    });
  });
});
