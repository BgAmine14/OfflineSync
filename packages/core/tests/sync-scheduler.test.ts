import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { SyncEngine } from '../src/sync-engine.js';
import { StubSyncTransport } from '../src/sync-transport.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { SyncScheduler } from '../src/sync-scheduler.js';
import { SyncTransportError } from '@offlinesync/transport-http';
import { SYNC_ERROR_CODE } from '@offlinesync/protocol';
import type { ConnectivityDetector } from '../src/connectivity-detector.js';

const validTimestamp = '2026-08-14T10:00:00Z';

/**
 * Create a minimal engine with no pending mutations.
 */
async function makeEngine(): Promise<{
  engine: SyncEngine;
  storage: InMemoryStorageAdapter;
  transport: StubSyncTransport;
}> {
  const storage = new InMemoryStorageAdapter();
  const transport = new StubSyncTransport();
  const queue = new MutationQueue({ storage });
  const engine = new SyncEngine({
    clientId: 'test-client',
    storage,
    mutationQueue: queue,
    transport,
  });
  return { engine, storage, transport };
}

describe('SyncScheduler', () => {
  let engine: SyncEngine;
  let transport: StubSyncTransport;
  let scheduler: SyncScheduler;

  beforeEach(async () => {
    const setup = await makeEngine();
    engine = setup.engine;
    transport = setup.transport;
  });

  afterEach(() => {
    scheduler?.dispose();
  });

  // ============================================================
  // Lifecycle
  // ============================================================

  describe('lifecycle', () => {
    it('should start and stop without errors', () => {
      scheduler = new SyncScheduler({
        engine,
        baseIntervalMs: 60_000,
      });
      expect(() => scheduler.start()).not.toThrow();
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('should throw on start after dispose', () => {
      scheduler = new SyncScheduler({ engine });
      scheduler.dispose();
      expect(() => scheduler.start()).toThrow('disposed');
    });

    it('should report isSyncing correctly', async () => {
      // Set up snapshot sync
      transport.setNextSnapshotResponse({
        entities: {},
        cursor: 'c',
        serverTimestamp: validTimestamp,
      });

      scheduler = new SyncScheduler({ engine });
      scheduler.start();

      // Trigger immediate sync
      scheduler.triggerSync();
      expect(scheduler.isSyncing).toBe(true);

      // Wait for the sync to complete
      await vi.waitFor(() => {
        expect(scheduler.isSyncing).toBe(false);
      }, { timeout: 2000 });

      scheduler.stop();
    });
  });

  // ============================================================
  // Backoff
  // ============================================================

  describe('backoff', () => {
    it('should reset interval after successful sync', async () => {
      const baseInterval = 1000;
      transport.setNextSnapshotResponse({
        entities: {},
        cursor: 'c',
        serverTimestamp: validTimestamp,
      });

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        baseIntervalMs: baseInterval,
        onSyncComplete: onComplete,
      });

      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      // After success, interval should be at base
      expect(scheduler.currentInterval).toBe(baseInterval);
      scheduler.stop();
    });

    it('should increase interval after consecutive transient failures', async () => {
      transport.failNext(new SyncTransportError(
        SYNC_ERROR_CODE.INTERNAL_ERROR,
        'Server error',
      ));

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        baseIntervalMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 10_000,
        onSyncComplete: onComplete,
      });

      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      // After 1 transient failure, interval = base * 2^1 = 2000
      expect(scheduler.currentInterval).toBe(2000);
      scheduler.stop();
    });

    it('should NOT increase interval for non-retryable errors (AUTHENTICATION)', async () => {
      transport.failNext(new SyncTransportError(
        SYNC_ERROR_CODE.AUTHENTICATION_FAILED,
        'Bad token',
      ));

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        baseIntervalMs: 1000,
        backoffMultiplier: 2,
        onSyncComplete: onComplete,
      });

      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      // AUTHENTICATION is non-retryable — interval stays at base
      expect(scheduler.currentInterval).toBe(1000);
      scheduler.stop();
    });

    it('should cap backoff at maxBackoffMs', async () => {
      // First failure
      transport.failNext(new SyncTransportError(
        SYNC_ERROR_CODE.INTERNAL_ERROR,
        'Error 1',
      ));

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        baseIntervalMs: 1000,
        backoffMultiplier: 100,
        maxBackoffMs: 5000,
        onSyncComplete: onComplete,
      });

      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      // base * multiplier^1 = 1000 * 100 = 100000, capped at 5000
      expect(scheduler.currentInterval).toBe(5000);
      scheduler.stop();
    });
  });

  // ============================================================
  // Connectivity
  // ============================================================

  describe('connectivity', () => {
    it('should trigger immediate sync when coming online', async () => {
      transport.setNextSnapshotResponse({
        entities: {},
        cursor: 'c',
        serverTimestamp: validTimestamp,
      });

      const callbacks: ((isOnline: boolean) => void)[] = [];
      const detector: ConnectivityDetector = {
        isOnline: false,
        onConnectivityChange(cb) {
          callbacks.push(cb);
          return () => {
            const idx = callbacks.indexOf(cb);
            if (idx >= 0) callbacks.splice(idx, 1);
          };
        },
        dispose() {
          callbacks.length = 0;
        },
      };

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        connectivityDetector: detector,
        baseIntervalMs: 60_000,
        onSyncComplete: onComplete,
      });

      scheduler.start();

      // Simulate coming online
      for (const cb of callbacks) {
        cb(true);
      }

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      scheduler.stop();
    });

    it('should NOT trigger sync when going offline', async () => {
      const callbacks: ((isOnline: boolean) => void)[] = [];
      const detector: ConnectivityDetector = {
        isOnline: true,
        onConnectivityChange(cb) {
          callbacks.push(cb);
          return () => {
            const idx = callbacks.indexOf(cb);
            if (idx >= 0) callbacks.splice(idx, 1);
          };
        },
        dispose() {
          callbacks.length = 0;
        },
      };

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({
        engine,
        connectivityDetector: detector,
        baseIntervalMs: 60_000,
        onSyncComplete: onComplete,
      });

      scheduler.start();

      // Simulate going offline
      for (const cb of callbacks) {
        cb(false);
      }

      // Wait briefly and confirm no sync happened
      await new Promise((r) => setTimeout(r, 200));
      expect(onComplete).not.toHaveBeenCalled();

      scheduler.stop();
    });
  });

  // ============================================================
  // onSyncComplete callback
  // ============================================================

  describe('onSyncComplete', () => {
    it('should call with result on success', async () => {
      transport.setNextSnapshotResponse({
        entities: {
          tasks: [
            {
              id: 'e1',
              data: { title: 'Task' },
              revision: 1,
              createdAt: validTimestamp,
              updatedAt: validTimestamp,
              isDeleted: false,
            },
          ],
        },
        cursor: 'c',
        serverTimestamp: validTimestamp,
      });

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({ engine, onSyncComplete: onComplete });
      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      const [result, error] = onComplete.mock.calls[0] as unknown[];
      expect(result).not.toBeNull();
      expect(error).toBeNull();
      scheduler.stop();
    });

    it('should call with error on failure', async () => {
      transport.failNext(new Error('Network failure'));

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({ engine, onSyncComplete: onComplete });
      scheduler.start();
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce();
      }, { timeout: 2000 });

      const [result, error] = onComplete.mock.calls[0] as unknown[];
      expect(result).toBeNull();
      expect(error).toBeInstanceOf(Error);
      scheduler.stop();
    });
  });

  // ============================================================
  // Trigger coalescing
  // ============================================================

  describe('trigger coalescing', () => {
    it('should coalesce multiple triggers while syncing', async () => {
      // First sync: snapshot (succeeds)
      transport.setNextSnapshotResponse({
        entities: {},
        cursor: 'c1',
        serverTimestamp: validTimestamp,
      });

      // Second sync: incremental (succeeds)
      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [],
        newCursor: 'c2',
      });

      const onComplete = vi.fn();
      scheduler = new SyncScheduler({ engine, onSyncComplete: onComplete });
      scheduler.start();

      // Trigger first sync
      scheduler.triggerSync();
      expect(scheduler.isSyncing).toBe(true);

      // While syncing, trigger again — should be coalesced
      scheduler.triggerSync();

      await vi.waitFor(() => {
        expect(onComplete.mock.calls.length).toBeGreaterThanOrEqual(1);
      }, { timeout: 2000 });

      // The coalesced trigger should also fire a second sync
      await vi.waitFor(() => {
        expect(onComplete.mock.calls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 2000 });

      scheduler.stop();
    });
  });
});
