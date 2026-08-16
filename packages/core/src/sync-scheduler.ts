/**
 * SyncScheduler — manages automatic periodic synchronization.
 *
 * The scheduler coordinates with the SyncEngine and an optional
 * ConnectivityDetector to provide:
 * - Periodic sync at a configurable base interval
 * - Exponential backoff on consecutive failures (INV-9)
 * - Immediate sync trigger when connectivity is restored
 * - Backoff reset on successful sync
 * - Start/stop lifecycle control
 *
 * The scheduler does NOT perform sync itself — it delegates to
 * the SyncEngine's sync() method.
 */

import type { SyncEngine, SyncCycleResult } from './sync-engine.js';
import type { ConnectivityDetector } from './connectivity-detector.js';
import { SyncTransportError } from '@offlinesync/transport-http';
import { ERROR_CLASSIFICATION } from './types/index.js';
import {
  ERROR_CODE_CLASSIFICATION,
  CLASSIFICATION_RETRY_BEHAVIOR,
} from '@offlinesync/protocol';
import type { ErrorClassification } from './types/index.js';

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

/**
 * Backoff behavior for a given error classification.
 */
interface BackoffBehavior {
  /** Whether the error is retryable. */
  readonly retryable: boolean;
  /** Optional maximum backoff cap specific to this classification. */
  readonly maxBackoffMs?: number;
}

/**
 * Configuration options for the SyncScheduler.
 */
export interface SyncSchedulerOptions {
  /** The sync engine to schedule sync cycles on. */
  readonly engine: SyncEngine;
  /**
   * Optional connectivity detector.
   * When provided, sync is triggered immediately when
   * connectivity changes from offline to online.
   */
  readonly connectivityDetector?: ConnectivityDetector;
  /**
   * Base interval between sync cycles in milliseconds.
   * @default 30_000 (30 seconds)
   */
  readonly baseIntervalMs?: number;
  /**
   * Multiplier for exponential backoff on consecutive failures.
   * @default 2
   */
  readonly backoffMultiplier?: number;
  /**
   * Maximum backoff interval in milliseconds.
   * @default 300_000 (5 minutes)
   */
  readonly maxBackoffMs?: number;
  /**
   * Optional callback invoked after each sync cycle completes.
   * Receives the result or the error if the cycle failed.
   */
  readonly onSyncComplete?: (
    result: SyncCycleResult | null,
    error: Error | null,
  ) => void;
}

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const DEFAULT_BASE_INTERVAL_MS = 30_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_BACKOFF_MS = 300_000;

// -------------------------------------------------------------------
// SyncScheduler
// -------------------------------------------------------------------

/**
 * Manages automatic periodic synchronization with backoff.
 *
 * The scheduler runs a single sync cycle at a time. If a sync
 * cycle is already in progress, additional triggers are coalesced
 * (the next cycle will start immediately after the current one finishes).
 *
 * @example
 * ```typescript
 * const scheduler = new SyncScheduler({
 *   engine: syncEngine,
 *   connectivityDetector: navigatorDetector,
 *   baseIntervalMs: 10_000,
 * });
 *
 * scheduler.start();
 * // ... later
 * scheduler.stop();
 * ```
 */
export class SyncScheduler {
  private readonly engine: SyncEngine;
  private readonly connectivityDetector: ConnectivityDetector | undefined;
  private readonly baseIntervalMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxBackoffMs: number;
  private readonly onSyncComplete:
    | ((result: SyncCycleResult | null, error: Error | null) => void)
    | undefined;

  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private syncInProgress = false;
  private consecutiveFailures = 0;
  private currentIntervalMs: number;
  private disposed = false;
  private pendingTrigger = false;
  private cleanupConnectivity: (() => void) | null = null;

  constructor(options: SyncSchedulerOptions) {
    this.engine = options.engine;
    this.connectivityDetector = options.connectivityDetector;
    this.baseIntervalMs = options.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS;
    this.backoffMultiplier =
      options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.onSyncComplete = options.onSyncComplete;
    this.currentIntervalMs = this.baseIntervalMs;
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Start the scheduler.
   *
   * Begins periodic sync cycles. If a ConnectivityDetector is
   * provided, also listens for connectivity changes.
   */
  start(): void {
    if (this.disposed) {
      throw new Error('SyncScheduler has been disposed');
    }

    this.setupConnectivityListener();
    this.scheduleNext();
  }

  /**
   * Stop the scheduler.
   *
   * Cancels any pending sync cycle and stops periodic scheduling.
   * Does not dispose the engine or connectivity detector.
   */
  stop(): void {
    this.cancelTimer();
    this.teardownConnectivityListener();
  }

  /**
   * Trigger an immediate sync cycle.
   *
   * If a sync is already in progress, the trigger is coalesced:
   * the next cycle will start immediately after the current one.
   */
  triggerSync(): void {
    if (this.syncInProgress) {
      this.pendingTrigger = true;
      return;
    }
    this.cancelTimer();
    void this.runSyncCycle();
  }

  /**
   * Dispose the scheduler, releasing all resources.
   *
   * After disposal, start() will throw.
   */
  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  /**
   * Get the current interval between sync cycles.
   *
   * This increases with consecutive failures (exponential backoff)
   * and resets to the base interval after a successful sync.
   */
  get currentInterval(): number {
    return this.currentIntervalMs;
  }

  /**
   * Whether a sync cycle is currently in progress.
   */
  get isSyncing(): boolean {
    return this.syncInProgress;
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  /**
   * Schedule the next sync cycle at the current interval.
   */
  private scheduleNext(): void {
    this.cancelTimer();

    if (this.disposed) return;

    this.timerHandle = setTimeout(() => {
      this.timerHandle = null;
      void this.runSyncCycle();
    }, this.currentIntervalMs);
  }

  /**
   * Cancel any pending timer.
   */
  private cancelTimer(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * Run a single sync cycle with error handling and backoff.
   */
  private async runSyncCycle(): Promise<void> {
    if (this.syncInProgress || this.disposed) return;

    this.syncInProgress = true;
    this.pendingTrigger = false;

    try {
      const result = await this.engine.sync();
      this.onCycleSuccess(result);
    } catch (error) {
      this.onCycleError(error);
    } finally {
      this.syncInProgress = false;

      // If a trigger was requested while we were syncing, run immediately
      if (this.pendingTrigger) {
        void this.runSyncCycle();
        return;
      }

      this.scheduleNext();
    }
  }

  /**
   * Handle a successful sync cycle.
   */
  private onCycleSuccess(result: SyncCycleResult): void {
    // Reset backoff on success
    this.consecutiveFailures = 0;
    this.currentIntervalMs = this.baseIntervalMs;
    this.onSyncComplete?.(result, null);
  }

  /**
   * Handle a failed sync cycle.
   *
   * Classifies the error to determine backoff behavior.
   * Non-retryable errors (AUTHENTICATION, PERMANENT) do not
   * increase the backoff — they require user intervention.
   */
  private onCycleError(error: unknown): void {
    const classification = this.classifyError(error);
    const behavior = this.getBackoffBehavior(classification);

    if (behavior.retryable) {
      this.consecutiveFailures += 1;
      this.currentIntervalMs = Math.min(
        this.baseIntervalMs *
          Math.pow(this.backoffMultiplier, this.consecutiveFailures),
        behavior.maxBackoffMs ?? this.maxBackoffMs,
      );
    }
    // Non-retryable errors: keep current interval (don't increase backoff)

    const errorObj =
      error instanceof Error ? error : new Error(String(error));
    this.onSyncComplete?.(null, errorObj);
  }

  /**
   * Classify a sync error using protocol mappings.
   */
  private classifyError(error: unknown): ErrorClassification {
    if (
      error instanceof SyncTransportError &&
      error.code in ERROR_CODE_CLASSIFICATION
    ) {
      return ERROR_CODE_CLASSIFICATION[
        error.code as keyof typeof ERROR_CODE_CLASSIFICATION
      ];
    }

    // Fall back to UNKNOWN for unrecognised errors
    return ERROR_CLASSIFICATION.UNKNOWN;
  }

  /**
   * Determine backoff behavior from error classification.
   */
  private getBackoffBehavior(
    classification: ErrorClassification,
  ): BackoffBehavior {
    const retryBehavior =
      CLASSIFICATION_RETRY_BEHAVIOR[
        classification as keyof typeof CLASSIFICATION_RETRY_BEHAVIOR
      ];

    if (retryBehavior === undefined) {
      return { retryable: true };
    }

    return {
      retryable: retryBehavior.shouldRetry,
    };
  }

  // ----------------------------------------------------------------
  // Connectivity
  // ----------------------------------------------------------------

  /**
   * Set up connectivity change listener.
   */
  private setupConnectivityListener(): void {
    if (this.connectivityDetector === undefined) return;

    this.cleanupConnectivity = this.connectivityDetector.onConnectivityChange(
      (isOnline) => {
        if (isOnline) {
          // Coming back online — trigger immediate sync
          this.triggerSync();
        }
      },
    );
  }

  /**
   * Tear down connectivity change listener.
   */
  private teardownConnectivityListener(): void {
    if (this.cleanupConnectivity !== null) {
      this.cleanupConnectivity();
      this.cleanupConnectivity = null;
    }
  }
}
