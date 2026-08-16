/**
 * Tests for LifecycleManager — graceful shutdown coordination.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LifecycleManager } from '../src/lifecycle-manager.js';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import type { SyncScheduler } from '../src/sync-scheduler.js';

describe('LifecycleManager', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  describe('shutdown', () => {
    it('should shut down cleanly with no resources', async () => {
      // Arrange
      const lifecycle = new LifecycleManager({});

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      expect(result.clean).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should stop the scheduler on shutdown', async () => {
      // Arrange
      const scheduler = {
        stop: vi.fn(),
      } as unknown as SyncScheduler;
      const lifecycle = new LifecycleManager({ scheduler });

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      expect(scheduler.stop).toHaveBeenCalledOnce();
      expect(result.clean).toBe(true);
    });

    it('should close storage on shutdown', async () => {
      // Arrange
      const lifecycle = new LifecycleManager({ storage });

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      expect(result.clean).toBe(true);
    });

    it('should shut down resources in order', async () => {
      // Arrange
      const order: string[] = [];
      const scheduler = {
        stop: vi.fn(() => {
          order.push('scheduler');
        }),
      } as unknown as SyncScheduler;

      const lifecycle = new LifecycleManager({
        scheduler,
        storage,
      });

      // Act
      await lifecycle.shutdown();

      // Assert
      expect(order[0]).toBe('scheduler');
    });

    it('should report errors from failed resources', async () => {
      // Arrange
      const badResource = {
        name: 'BadResource',
        dispose: vi.fn(() => {
          throw new Error('Resource cleanup failed');
        }),
      };
      const lifecycle = new LifecycleManager({ storage });
      lifecycle.addResource(badResource);

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      expect(result.clean).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('BadResource');
      expect(result.errors[0]).toContain('Resource cleanup failed');
    });

    it('should continue shutting down after an error', async () => {
      // Arrange
      const secondDisposed = vi.fn();
      const badResource = {
        name: 'BadResource',
        dispose: vi.fn(() => {
          throw new Error('fail');
        }),
      };
      const goodResource = {
        name: 'GoodResource',
        dispose: vi.fn(() => {
          secondDisposed();
        }),
      };
      const lifecycle = new LifecycleManager({ storage });
      lifecycle.addResource(badResource);
      lifecycle.addResource(goodResource);

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      expect(result.clean).toBe(false);
      expect(secondDisposed).toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('should return clean result on second shutdown call', async () => {
      // Arrange
      const scheduler = {
        stop: vi.fn(),
      } as unknown as SyncScheduler;
      const lifecycle = new LifecycleManager({ scheduler });

      // Act
      const result1 = await lifecycle.shutdown();
      const result2 = await lifecycle.shutdown();

      // Assert
      expect(result1.clean).toBe(true);
      expect(result2.clean).toBe(true);
      expect(result2.durationMs).toBe(0);
    });
  });

  describe('state tracking', () => {
    it('should not be shutting down initially', () => {
      // Arrange
      const lifecycle = new LifecycleManager({});

      // Assert
      expect(lifecycle.isShuttingDown).toBe(false);
      expect(lifecycle.isShutdownComplete).toBe(false);
    });

    it('should be shutting down during shutdown', async () => {
      // Arrange
      const slowResource = {
        name: 'SlowResource',
        dispose: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 50);
            }),
        ),
      };
      const lifecycle = new LifecycleManager({});
      lifecycle.addResource(slowResource);

      // Act
      const shutdownPromise = lifecycle.shutdown();

      // Assert
      expect(lifecycle.isShuttingDown).toBe(true);

      await shutdownPromise;
      expect(lifecycle.isShutdownComplete).toBe(true);
    });

    it('should reject concurrent shutdown calls', async () => {
      // Arrange
      const slowResource = {
        name: 'SlowResource',
        dispose: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 50);
            }),
        ),
      };
      const lifecycle = new LifecycleManager({});
      lifecycle.addResource(slowResource);

      // Act
      const shutdownPromise = lifecycle.shutdown();
      const concurrentResult = await lifecycle.shutdown();

      // Assert
      expect(concurrentResult.clean).toBe(false);
      expect(concurrentResult.errors).toHaveLength(1);
      expect(concurrentResult.errors[0]).toContain('already in progress');

      await shutdownPromise;
    });
  });

  describe('timeout', () => {
    it('should timeout if shutdown takes too long', async () => {
      // Arrange
      const slowResource = {
        name: 'SlowResource',
        dispose: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 10_000);
            }),
        ),
      };
      const lifecycle = new LifecycleManager({
        shutdownTimeoutMs: 10,
      });
      lifecycle.addResource(slowResource);

      // Act
      const result = await lifecycle.shutdown();

      // Assert
      // Should complete within timeout, possibly with errors
      expect(result.durationMs).toBeLessThan(500);
    }, 5000);
  });

  describe('addResource', () => {
    it('should add custom resource for shutdown', async () => {
      // Arrange
      const customDispose = vi.fn();
      const lifecycle = new LifecycleManager({});
      lifecycle.addResource({
        name: 'CustomResource',
        dispose: customDispose,
      });

      // Act
      await lifecycle.shutdown();

      // Assert
      expect(customDispose).toHaveBeenCalledOnce();
    });
  });
});
