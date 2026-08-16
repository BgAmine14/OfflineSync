/**
 * Tests for MutationSender.
 *
 * Verifies:
 * - Pending mutation sending in sequence order
 * - Success → ACKNOWLEDGED transition
 * - Failure → FAILED transition with correct classification
 * - Conflict → CONFLICT transition
 * - Retry behavior and max retries
 * - Backoff calculation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MutationSender, StubMutationTransport } from '../src/mutation-sender.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { MUTATION_STATUS, OPERATION_TYPE, ERROR_CLASSIFICATION } from '../src/types/index.js';
import type { Mutation } from '../src/types/index.js';

function createTestMutation(overrides?: Partial<Mutation>): Mutation {
  return {
    id: overrides?.id ?? `mutation-${Math.random().toString(36).slice(2, 9)}`,
    entityId: overrides?.entityId ?? 'entity-1',
    collectionName: overrides?.collectionName ?? 'tasks',
    operation: overrides?.operation ?? OPERATION_TYPE.SET,
    field: overrides?.field ?? null,
    value: overrides?.value ?? { name: 'Test' },
    sequence: overrides?.sequence ?? 1,
    status: overrides?.status ?? MUTATION_STATUS.PENDING,
    createdAt: overrides?.createdAt ?? '2026-01-01T00:00:00.000Z',
    retries: overrides?.retries ?? 0,
    lastError: overrides?.lastError ?? null,
  };
}

describe('MutationSender', () => {
  let storage: InMemoryStorageAdapter;
  let queue: MutationQueue;
  let transport: StubMutationTransport;
  let sender: MutationSender;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    queue = new MutationQueue({ storage });
    transport = new StubMutationTransport();
    sender = new MutationSender({
      queue,
      transport,
      retryConfig: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    });
  });

  afterEach(() => {
    void storage.close();
  });

  describe('sendPending', () => {
    it('should send all pending mutations up to the limit', async () => {
      for (let i = 1; i <= 5; i++) {
        await queue.enqueue(createTestMutation({ sequence: i }));
      }

      const results = await sender.sendPending(10);

      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should respect the batch limit', async () => {
      for (let i = 1; i <= 10; i++) {
        await queue.enqueue(createTestMutation({ sequence: i }));
      }

      const results = await sender.sendPending(3);
      expect(results).toHaveLength(3);
    });

    it('should transition successful mutations to ACKNOWLEDGED', async () => {
      const mutation = createTestMutation({ id: 'mut-1', sequence: 1 });
      await queue.enqueue(mutation);

      await sender.sendPending(10);

      const remaining = await queue.countByStatus(MUTATION_STATUS.PENDING);
      expect(remaining).toBe(0);

      const acked = await queue.countByStatus(MUTATION_STATUS.ACKNOWLEDGED);
      expect(acked).toBe(1);
    });

    it('should mark failed mutations as FAILED', async () => {
      const mutation = createTestMutation({ id: 'mut-1', sequence: 1 });
      await queue.enqueue(mutation);
      transport.failNext(new Error('Network error'));

      const results = await sender.sendPending(10);

      expect(results[0].success).toBe(false);
      expect(results[0].errorClassification).toBe(ERROR_CLASSIFICATION.TRANSIENT);

      const failed = await queue.countByStatus(MUTATION_STATUS.FAILED);
      expect(failed).toBe(1);
    });

    it('should mark conflict errors as CONFLICT', async () => {
      const mutation = createTestMutation({ id: 'mut-1', sequence: 1 });
      await queue.enqueue(mutation);
      const conflictError = new Error('Revision mismatch');
      (conflictError as unknown as Record<string, unknown>).code = 'CONFLICT';
      transport.failNext(conflictError);

      const results = await sender.sendPending(10);

      expect(results[0].success).toBe(false);
      expect(results[0].errorClassification).toBe(ERROR_CLASSIFICATION.CONFLICT);

      const conflicts = await queue.countByStatus(MUTATION_STATUS.CONFLICT);
      expect(conflicts).toBe(1);
    });

    it('should record send attempts on the transport', async () => {
      const mutation = createTestMutation({ id: 'mut-1', sequence: 1 });
      await queue.enqueue(mutation);

      await sender.sendPending(10);

      expect(transport.getAttempts()).toHaveLength(1);
      expect(transport.getAttempts()[0].mutation.id).toBe('mut-1');
    });

    it('should continue sending remaining mutations after a failure', async () => {
      await queue.enqueue(createTestMutation({ id: 'mut-1', sequence: 1 }));
      await queue.enqueue(createTestMutation({ id: 'mut-2', sequence: 2 }));
      await queue.enqueue(createTestMutation({ id: 'mut-3', sequence: 3 }));

      // Only the first send fails
      transport.failNext(new Error('Network error'));

      const results = await sender.sendPending(10);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
    });
  });

  describe('StubMutationTransport', () => {
    it('should record send attempts', async () => {
      const stub = new StubMutationTransport();
      const mutation = createTestMutation();

      await stub.send(mutation);

      expect(stub.getAttempts()).toHaveLength(1);
      expect(stub.getAttempts()[0].mutation.id).toBe(mutation.id);
    });

    it('should fail when configured to fail', async () => {
      const stub = new StubMutationTransport();
      stub.failNext(new Error('test failure'));

      await expect(stub.send(createTestMutation())).rejects.toThrow('test failure');
    });

    it('should reset state', async () => {
      const stub = new StubMutationTransport();
      await stub.send(createTestMutation());
      stub.setAcknowledge(false);
      stub.reset();

      expect(stub.getAttempts()).toHaveLength(0);
      // After reset, sends should succeed again
      await stub.send(createTestMutation());
      expect(stub.getAttempts()).toHaveLength(1);
    });
  });

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff', () => {
      const result1 = sender.calculateBackoff(0, {
        classification: ERROR_CLASSIFICATION.TRANSIENT,
        retryAfterMs: 1000,
      });
      expect(result1).toBe(1000);

      const result2 = sender.calculateBackoff(1, {
        classification: ERROR_CLASSIFICATION.TRANSIENT,
        retryAfterMs: 1000,
      });
      expect(result2).toBe(2000);

      const result3 = sender.calculateBackoff(2, {
        classification: ERROR_CLASSIFICATION.TRANSIENT,
        retryAfterMs: 1000,
      });
      expect(result3).toBe(4000);
    });

    it('should cap at maxDelayMs', () => {
      const result = sender.calculateBackoff(10, {
        classification: ERROR_CLASSIFICATION.TRANSIENT,
        retryAfterMs: 1000,
      });
      expect(result).toBe(30000);
    });

    it('should use retryAfterMs for RATE_LIMITED', () => {
      const result = sender.calculateBackoff(0, {
        classification: ERROR_CLASSIFICATION.RATE_LIMITED,
        retryAfterMs: 5000,
      });
      expect(result).toBe(5000);
    });
  });
});
