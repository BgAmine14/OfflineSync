/**
 * Tests for MutationRecorder.
 *
 * Verifies:
 * - Mutation creation for each operation type
 * - Monotonically increasing sequence numbers (INV-1)
 * - Sequence initialization from existing state
 * - ID generation delegation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MutationRecorder, type IdGenerator } from '../src/mutation-recorder.js';
import { OPERATION_TYPE, MUTATION_STATUS } from '../src/types/index.js';
import type { Entity } from '@offlinesync/storage';

describe('MutationRecorder', () => {
  let recorder: MutationRecorder;
  let idCounter: number;

  /** Simple counter-based ID generator for testing. */
  function createTestIdGenerator(): IdGenerator {
    idCounter = 0;
    return {
      generate(): string {
        idCounter += 1;
        return `test-mutation-${String(idCounter).padStart(4, '0')}`;
      },
    };
  }

  function createTestEntity(overrides?: Partial<Entity<{ name: string }>>): Entity<{ name: string }> {
    return {
      id: overrides?.id ?? 'entity-1',
      data: overrides?.data ?? { name: 'Test' },
      revision: overrides?.revision ?? 1,
      createdAt: overrides?.createdAt ?? '2026-01-01T00:00:00.000Z',
      updatedAt: overrides?.updatedAt ?? '2026-01-01T00:00:00.000Z',
      isDeleted: overrides?.isDeleted ?? false,
    };
  }

  beforeEach(() => {
    recorder = new MutationRecorder({
      idGenerator: createTestIdGenerator(),
    });
  });

  describe('recordSet', () => {
    it('should create a set mutation with correct fields', () => {
      const entity = createTestEntity();
      const mutation = recorder.recordSet('tasks', entity);

      expect(mutation.id).toBe('test-mutation-0001');
      expect(mutation.entityId).toBe('entity-1');
      expect(mutation.collectionName).toBe('tasks');
      expect(mutation.operation).toBe(OPERATION_TYPE.SET);
      expect(mutation.field).toBeNull();
      expect(mutation.value).toEqual({ name: 'Test' });
      expect(mutation.sequence).toBe(1);
      expect(mutation.status).toBe(MUTATION_STATUS.PENDING);
      expect(mutation.retries).toBe(0);
      expect(mutation.lastError).toBeNull();
      expect(mutation.createdAt).toBeDefined();
    });

    it('should store the full entity data as value', () => {
      const entity = createTestEntity({ data: { name: 'Updated' } });
      const mutation = recorder.recordSet('users', entity);

      expect(mutation.value).toEqual({ name: 'Updated' });
    });
  });

  describe('recordPatch', () => {
    it('should create a patch mutation with null field', () => {
      const mutation = recorder.recordPatch('tasks', 'entity-1', { name: 'Updated' });

      expect(mutation.operation).toBe(OPERATION_TYPE.PATCH);
      expect(mutation.field).toBeNull();
      expect(mutation.value).toEqual({ name: 'Updated' });
      expect(mutation.entityId).toBe('entity-1');
    });
  });

  describe('recordDelete', () => {
    it('should create a set mutation for deleted entity', () => {
      const entity = createTestEntity({ isDeleted: true });
      const mutation = recorder.recordDelete('tasks', entity);

      expect(mutation.operation).toBe(OPERATION_TYPE.SET);
      expect(mutation.entityId).toBe('entity-1');
      expect(mutation.value).toEqual({ name: 'Test' });
    });
  });

  describe('recordIncrement', () => {
    it('should create an increment mutation with field and amount', () => {
      const mutation = recorder.recordIncrement('tasks', 'entity-1', 'count', 5);

      expect(mutation.operation).toBe(OPERATION_TYPE.INCREMENT);
      expect(mutation.field).toBe('count');
      expect(mutation.value).toBe(5);
    });
  });

  describe('recordDecrement', () => {
    it('should create a decrement mutation with field and amount', () => {
      const mutation = recorder.recordDecrement('tasks', 'entity-1', 'count', 3);

      expect(mutation.operation).toBe(OPERATION_TYPE.DECREMENT);
      expect(mutation.field).toBe('count');
      expect(mutation.value).toBe(3);
    });
  });

  describe('recordAdd', () => {
    it('should create an add mutation with field and item', () => {
      const mutation = recorder.recordAdd('tasks', 'entity-1', 'tags', 'urgent');

      expect(mutation.operation).toBe(OPERATION_TYPE.ADD);
      expect(mutation.field).toBe('tags');
      expect(mutation.value).toBe('urgent');
    });
  });

  describe('recordRemove', () => {
    it('should create a remove mutation with field and item', () => {
      const mutation = recorder.recordRemove('tasks', 'entity-1', 'tags', 'urgent');

      expect(mutation.operation).toBe(OPERATION_TYPE.REMOVE);
      expect(mutation.field).toBe('tags');
      expect(mutation.value).toBe('urgent');
    });
  });

  describe('INV-1: Sequence numbers', () => {
    it('should assign monotonically increasing sequences within a collection', () => {
      const entity = createTestEntity();
      const m1 = recorder.recordSet('tasks', entity);
      const m2 = recorder.recordSet('tasks', entity);
      const m3 = recorder.recordSet('tasks', entity);

      expect(m1.sequence).toBe(1);
      expect(m2.sequence).toBe(2);
      expect(m3.sequence).toBe(3);
    });

    it('should track sequences independently per collection', () => {
      const entity = createTestEntity();
      const taskMutation = recorder.recordSet('tasks', entity);
      const userMutation = recorder.recordSet('users', entity);
      const taskMutation2 = recorder.recordSet('tasks', entity);
      const userMutation2 = recorder.recordSet('users', entity);

      expect(taskMutation.sequence).toBe(1);
      expect(userMutation.sequence).toBe(1);
      expect(taskMutation2.sequence).toBe(2);
      expect(userMutation2.sequence).toBe(2);
    });
  });

  describe('initializeSequence', () => {
    it('should set the sequence tracker to the given max', () => {
      recorder.initializeSequence('tasks', 42);
      const entity = createTestEntity();
      const mutation = recorder.recordSet('tasks', entity);

      expect(mutation.sequence).toBe(43);
    });

    it('should not decrease the sequence tracker', () => {
      const entity = createTestEntity();
      const m1 = recorder.recordSet('tasks', entity);
      expect(m1.sequence).toBe(1);

      recorder.initializeSequence('tasks', 0);
      const m2 = recorder.recordSet('tasks', entity);
      expect(m2.sequence).toBe(2);
    });

    it('should not affect other collections', () => {
      recorder.initializeSequence('tasks', 10);
      const entity = createTestEntity();
      const userMutation = recorder.recordSet('users', entity);

      expect(userMutation.sequence).toBe(1);
    });
  });

  describe('getCurrentSequence', () => {
    it('should return 0 for a collection with no mutations', () => {
      expect(recorder.getCurrentSequence('tasks')).toBe(0);
    });

    it('should return the last assigned sequence number', () => {
      const entity = createTestEntity();
      recorder.recordSet('tasks', entity);
      recorder.recordSet('tasks', entity);
      recorder.recordSet('tasks', entity);

      expect(recorder.getCurrentSequence('tasks')).toBe(3);
    });
  });
});
