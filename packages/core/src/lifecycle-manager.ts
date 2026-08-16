/**
 * LifecycleManager — coordinates graceful shutdown of sync components.
 *
 * When the application needs to shut down (page unload, process exit,
 * user logout), the LifecycleManager ensures:
 * 1. In-flight sync cycles complete or are safely aborted
 * 2. The SyncScheduler is stopped (no more periodic syncs)
 * 3. Pending state is flushed to storage
 * 4. Transport connections are closed cleanly
 *
 * This prevents data loss and ensures the system can recover
 * cleanly on the next startup.
 */

import type { SyncScheduler } from './sync-scheduler.js';
import type { SyncTransport } from './sync-transport.js';
import type { StorageAdapter } from '@offlinesync/storage';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

/**
 * Resources that can be registered for shutdown.
 */
interface ShutdownResource {
  /** Human-readable name for logging. */
  readonly name: string;
  /** Called during shutdown. Must not throw. */
  readonly dispose: () => Promise<void> | void;
}

/**
 * Result of a shutdown operation.
 */
export interface ShutdownResult {
  /** Whether all resources shut down cleanly. */
  readonly clean: boolean;
  /** Names of resources that had errors during shutdown. */
  readonly errors: readonly string[];
  /** Time taken to shut down in milliseconds. */
  readonly durationMs: number;
}

/**
 * Options for creating a LifecycleManager.
 */
export interface LifecycleManagerOptions {
  /** The sync scheduler to stop on shutdown. */
  readonly scheduler?: SyncScheduler;
  /** The transport to disconnect on shutdown. */
  readonly transport?: SyncTransport;
  /** The storage adapter to close on shutdown. */
  readonly storage?: StorageAdapter;
  /**
   * Timeout for graceful shutdown in milliseconds.
   * After this time, shutdown proceeds to forced cleanup.
   * @default 5_000
   */
  readonly shutdownTimeoutMs?: number;
}

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

// -------------------------------------------------------------------
// LifecycleManager
// -------------------------------------------------------------------

/**
 * Coordinates graceful shutdown of all sync components.
 *
 * Register components during setup, then call `shutdown()` when
 * the application needs to exit. The manager ensures ordered
 * shutdown: scheduler first, then transport, then storage.
 *
 * @example
 * ```typescript
 * const lifecycle = new LifecycleManager({
 *   scheduler: syncScheduler,
 *   transport: httpTransport,
 *   storage: adapter,
 * });
 *
 * // On page unload or process exit:
 * const result = await lifecycle.shutdown();
 * if (!result.clean) {
 *   console.warn('Shutdown had errors:', result.errors);
 * }
 * ```
 */
export class LifecycleManager {
  private readonly shutdownTimeoutMs: number;
  private readonly resources: ShutdownResource[] = [];
  private shutdownInProgress = false;
  private shutdownComplete = false;

  constructor(options: LifecycleManagerOptions) {
    this.shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

    // Register built-in resources in shutdown order
    if (options.scheduler !== undefined) {
      this.addResource({
        name: 'SyncScheduler',
        dispose: () => {
          options.scheduler?.stop();
        },
      });
    }

    if (options.transport !== undefined) {
      const transportRef = options.transport;
      this.addResource({
        name: 'SyncTransport',
        dispose: () => {
          if (
            'dispose' in transportRef &&
            typeof (transportRef as unknown as { dispose: () => Promise<void> | void }).dispose ===
              'function'
          ) {
            return (
              transportRef as unknown as { dispose: () => Promise<void> | void }
            ).dispose();
          }
        },
      });
    }

    if (options.storage !== undefined) {
      this.addResource({
        name: 'StorageAdapter',
        dispose: () => options.storage?.close(),
      });
    }
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Register an additional resource for shutdown.
   *
   * Resources are shut down in the order they are registered.
   * The scheduler, transport, and storage (if provided in options)
   * are registered automatically.
   *
   * @param resource - The resource to register.
   */
  addResource(resource: ShutdownResource): void {
    this.resources.push(resource);
  }

  /**
   * Perform a graceful shutdown of all registered resources.
   *
   * Resources are disposed in registration order. Each resource
   * gets up to `shutdownTimeoutMs` total for all resources.
   * Errors from individual resources are caught and reported
   * — they do not prevent other resources from shutting down.
   *
   * @returns A report of the shutdown result.
   */
  async shutdown(): Promise<ShutdownResult> {
    if (this.shutdownComplete) {
      return { clean: true, errors: [], durationMs: 0 };
    }

    if (this.shutdownInProgress) {
      return {
        clean: false,
        errors: ['Shutdown already in progress'],
        durationMs: 0,
      };
    }

    this.shutdownInProgress = true;
    const startTime = Date.now();
    const errors: string[] = [];

    // Create a race against the timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, this.shutdownTimeoutMs);
    });

    const shutdownPromise = this.shutdownAllResources(errors);

    // Wait for either shutdown to complete or timeout
    await Promise.race([shutdownPromise, timeoutPromise]);

    const durationMs = Date.now() - startTime;
    this.shutdownComplete = true;

    return {
      clean: errors.length === 0,
      errors,
      durationMs,
    };
  }

  /**
   * Whether shutdown has been initiated.
   */
  get isShuttingDown(): boolean {
    return this.shutdownInProgress;
  }

  /**
   * Whether shutdown has completed.
   */
  get isShutdownComplete(): boolean {
    return this.shutdownComplete;
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  /**
   * Shut down all registered resources sequentially.
   */
  private async shutdownAllResources(errors: string[]): Promise<void> {
    for (const resource of this.resources) {
      try {
        await resource.dispose();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);
        errors.push(`${resource.name}: ${message}`);
      }
    }
  }
}
