/**
 * MutationSender — sends mutations to the transport layer.
 *
 * In Phase 4, this is a stub that records send attempts.
 * The actual transport integration happens in Phase 6 (HTTP transport).
 *
 * The sender is responsible for:
 * - Picking up pending mutations from the queue
 * - Transitioning them to IN_FLIGHT
 * - Calling the transport send function
 * - Handling the response (ACKNOWLEDGED, FAILED, CONFLICT)
 * - Retrying failed mutations with appropriate backoff (INV-9)
 */

import type { Mutation, ErrorClassification } from './types/index.js';
import { ERROR_CLASSIFICATION } from './types/index.js';
import type { MutationQueue } from './mutation-queue.js';
import { ErrorClassifier, type ClassifiedError } from './error-classifier.js';

/**
 * Result of sending a single mutation.
 */
export interface SendResult {
  /** The mutation that was sent. */
  readonly mutation: Mutation;
  /** Whether the send was successful. */
  readonly success: boolean;
  /** The error classification if the send failed. */
  readonly errorClassification?: ErrorClassification;
  /** The error message if the send failed. */
  readonly errorMessage?: string;
}

/**
 * Transport interface for sending mutations.
 * This will be implemented by @offlinesync/transport-http in Phase 6.
 */
export interface MutationTransport {
  /**
   * Send a mutation to the server.
   *
   * @param mutation - The mutation to send.
   * @returns A promise that resolves on success (ACKNOWLEDGED)
   *   or rejects with an error on failure.
   */
  send(mutation: Mutation): Promise<void>;
}

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts per mutation. */
  readonly maxRetries: number;
  /** Base delay in milliseconds for exponential backoff. */
  readonly baseDelayMs: number;
  /** Maximum delay in milliseconds for exponential backoff. */
  readonly maxDelayMs: number;
  /** Multiplier for exponential backoff. */
  readonly backoffMultiplier: number;
}

/**
 * Default retry configuration.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

/**
 * A recorded send attempt, used by the stub transport for testing.
 */
export interface SendAttempt {
  readonly mutation: Mutation;
  readonly timestamp: string;
}

/**
 * Stub transport that records send attempts without actually sending.
 * Used for testing and until Phase 6 (real HTTP transport).
 */
export class StubMutationTransport implements MutationTransport {
  private readonly attempts: SendAttempt[] = [];
  private nextError: Error | null = null;
  private shouldAcknowledge = true;

  /**
   * Record a send attempt. If shouldFail was called, rejects instead.
   */
  async send(mutation: Mutation): Promise<void> {
    this.attempts.push({
      mutation,
      timestamp: new Date().toISOString(),
    });

    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }

    if (!this.shouldAcknowledge) {
      throw new Error('Stub transport configured to reject');
    }
  }

  /**
   * Get all recorded send attempts.
   *
   * @returns Array of send attempts in order.
   */
  getAttempts(): readonly SendAttempt[] {
    return this.attempts;
  }

  /**
   * Configure the next send call to throw an error.
   *
   * @param error - The error to throw on the next send.
   */
  failNext(error: Error): void {
    this.nextError = error;
  }

  /**
   * Configure whether sends should succeed or fail.
   *
   * @param acknowledge - If false, all sends will throw.
   */
  setAcknowledge(acknowledge: boolean): void {
    this.shouldAcknowledge = acknowledge;
  }

  /**
   * Reset all recorded attempts.
   */
  reset(): void {
    this.attempts.length = 0;
    this.nextError = null;
    this.shouldAcknowledge = true;
  }
}

/**
 * Sends mutations to the transport layer.
 *
 * The sender coordinates with the MutationQueue to:
 * 1. Dequeue pending mutations
 * 2. Mark them IN_FLIGHT
 * 3. Send via the transport
 * 4. Handle success (ACKNOWLEDGED) or failure (FAILED/CONFLICT)
 * 5. Retry transient failures with exponential backoff (INV-9)
 *
 * @example
 * ```typescript
 * const sender = new MutationSender({
 *   queue,
 *   transport: new StubMutationTransport(),
 * });
 * const results = await sender.sendPending(10);
 * ```
 */
export class MutationSender {
  private readonly queue: MutationQueue;
  private readonly transport: MutationTransport;
  private readonly classifier = new ErrorClassifier();
  private readonly retryConfig: RetryConfig;

  constructor(
    options: {
      readonly queue: MutationQueue;
      readonly transport: MutationTransport;
      readonly retryConfig?: RetryConfig;
    },
  ) {
    this.queue = options.queue;
    this.transport = options.transport;
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  /**
   * Send pending mutations from the queue.
   *
   * Mutations are sent in sequence number order (INV-1).
   * Each mutation is sent individually; if one fails, the
   * remaining mutations are still attempted.
   *
   * @param limit - Maximum number of mutations to send in this batch.
   * @returns Array of send results for each mutation.
   */
  async sendPending(limit: number): Promise<SendResult[]> {
    const mutations = await this.queue.dequeuePending(limit);
    const results: SendResult[] = [];

    for (const mutation of mutations) {
      const result = await this.sendOne(mutation);
      results.push(result);
    }

    return results;
  }

  /**
   * Retry a specific failed mutation.
   *
   * Only retries if the error classification allows it
   * (TRANSIENT, RATE_LIMITED, or UNKNOWN) and the retry
   * count has not exceeded the maximum.
   *
   * @param mutationId - The ID of the mutation to retry.
   * @returns The send result, or null if retry is not allowed.
   */
  async retryMutation(mutationId: string): Promise<SendResult | null> {
    const mutations = await this.queue.getMutationsForEntity('', '');
    const mutation = mutations.find((m) => m.id === mutationId);
    if (mutation === undefined) {
      return null;
    }

    if (!this.canRetry(mutation)) {
      return null;
    }

    await this.queue.retry(mutationId);
    return this.sendOne(mutation);
  }

  /**
   * Send a single mutation through the transport.
   */
  private async sendOne(mutation: Mutation): Promise<SendResult> {
    try {
      await this.queue.markInFlight(mutation.id);
      await this.transport.send(mutation);
      await this.queue.acknowledge(mutation.id);
      return { mutation, success: true };
    } catch (error) {
      return this.handleSendError(mutation, error);
    }
  }

  /**
   * Handle a send error by classifying it and updating the mutation.
   */
  private async handleSendError(
    mutation: Mutation,
    error: unknown,
  ): Promise<SendResult> {
    const classified = this.classifier.classify(error);
    const errorMessage =
        error instanceof Error ? error.message : String(error);

    switch (classified.classification) {
      case ERROR_CLASSIFICATION.CONFLICT:
        await this.queue.markConflict(mutation.id, errorMessage);
        return {
          mutation,
          success: false,
          errorClassification: ERROR_CLASSIFICATION.CONFLICT,
          errorMessage,
        };

      case ERROR_CLASSIFICATION.AUTHENTICATION:
      case ERROR_CLASSIFICATION.PERMANENT:
        await this.queue.markFailed(mutation.id, errorMessage);
        return {
          mutation,
          success: false,
          errorClassification: classified.classification,
          errorMessage,
        };

      case ERROR_CLASSIFICATION.TRANSIENT:
      case ERROR_CLASSIFICATION.RATE_LIMITED:
      case ERROR_CLASSIFICATION.UNKNOWN:
      default: {
        // Retryable error
        if (this.canRetry(mutation)) {
          await this.queue.markFailed(mutation.id, errorMessage);
          return {
            mutation,
            success: false,
            errorClassification: classified.classification,
            errorMessage,
          };
        }
        // Max retries exceeded — permanent failure
        await this.queue.markFailed(
          mutation.id,
          `Max retries (${this.retryConfig.maxRetries}) exceeded: ${errorMessage}`,
        );
        return {
          mutation,
          success: false,
          errorClassification: ERROR_CLASSIFICATION.PERMANENT,
          errorMessage: `Max retries exceeded: ${errorMessage}`,
        };
      }
    }
  }

  /**
 * Calculate the backoff delay for a given retry count.
 */
  calculateBackoff(retryCount: number, classified: ClassifiedError): number {
    if (classified.classification === ERROR_CLASSIFICATION.RATE_LIMITED &&
        classified.retryAfterMs > 0) {
      return classified.retryAfterMs;
    }

    const delay =
      this.retryConfig.baseDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, retryCount);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  /**
 * Check whether a mutation can be retried.
 */
  private canRetry(mutation: Mutation): boolean {
    return mutation.retries < this.retryConfig.maxRetries;
  }
}
