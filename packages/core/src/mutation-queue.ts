/**
 * MutationQueue — durable, ordered queue of pending mutations.
 *
 * The queue stores mutations via the StorageAdapter (they are just entities
 * in a special '__mutations__' collection). This ensures durability (INV-4)
 * and allows the queue to survive process restarts.
 *
 * Mutations are always returned in sequence number order (INV-1).
 */

import type { Entity, StorageAdapter, Transaction } from '@offlinesync/storage';
import { createQuery } from '@offlinesync/storage';
import type {
  Mutation,
  MutationStatus,
} from './types/index.js';
import { MUTATION_STATUS } from './types/index.js';

/**
 * The collection name used to store mutations in the StorageAdapter.
 * This is a reserved collection name that must not be used by application code.
 */
const MUTATIONS_COLLECTION = '__mutations__';

/**
 * Internal entity data shape for persisted mutations.
 * The Mutation interface fields are stored inside the Entity's data field.
 */
interface MutationRecord {
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

/**
 * Transaction-like interface for enqueue.
 * Both StorageAdapter and Transaction share put(), so we use this union.
 */
type StorageWriter = StorageAdapter | Transaction;

/**
 * Convert a Mutation to a storable Entity<MutationRecord>.
 */
function mutationToEntity(mutation: Mutation): Entity<MutationRecord> {
  return {
    id: mutation.id,
    data: {
      entityId: mutation.entityId,
      collectionName: mutation.collectionName,
      operation: mutation.operation,
      field: mutation.field,
      value: mutation.value,
      sequence: mutation.sequence,
      status: mutation.status,
      createdAt: mutation.createdAt,
      retries: mutation.retries,
      lastError: mutation.lastError,
    },
    revision: 1,
    createdAt: mutation.createdAt,
    updatedAt: mutation.createdAt,
    isDeleted: false,
  };
}

/**
 * Convert a stored Entity<MutationRecord> back to a Mutation.
 */
function entityToMutation(entity: Entity<MutationRecord>): Mutation {
  return {
    id: entity.id,
    entityId: entity.data.entityId,
    collectionName: entity.data.collectionName,
    operation: entity.data.operation as Mutation['operation'],
    field: entity.data.field,
    value: entity.data.value,
    sequence: entity.data.sequence,
    status: entity.data.status as MutationStatus,
    createdAt: entity.data.createdAt,
    retries: entity.data.retries,
    lastError: entity.data.lastError,
  };
}

/**
 * Options for creating a MutationQueue.
 */
export interface MutationQueueOptions {
  /** The storage adapter to use for durable persistence. */
  readonly storage: StorageAdapter;
}

/**
 * A durable, ordered queue of mutations.
 *
 * Mutations are stored via the StorageAdapter in a reserved collection.
 * The queue provides methods to enqueue, dequeue, and update mutations,
 * always maintaining sequence number order (INV-1).
 *
 * Every mutation in the queue survives process restart (INV-4).
 *
 * @example
 * ```typescript
 * const queue = new MutationQueue({ storage: adapter });
 * await queue.enqueue(mutation);
 * const pending = await queue.dequeuePending(10);
 * await queue.acknowledge(mutation.id);
 * ```
 */
export class MutationQueue {
  private readonly storage: StorageAdapter;

  constructor(options: MutationQueueOptions) {
    this.storage = options.storage;
  }

  /**
   * Add a mutation to the queue.
   *
   * This is typically called within the same transaction as the
   * entity write (INV-8). The caller should use
   * `storage.transaction()` and call both the entity put and
   * this method inside the callback.
   *
   * @param mutation - The mutation to enqueue.
   * @param tx - An optional transaction or storage adapter.
   *   If provided, the mutation is stored via this writer instead
   *   of the queue's own storage adapter.
   */
  async enqueue(
    mutation: Mutation,
    tx?: StorageWriter,
  ): Promise<void> {
    const entity = mutationToEntity(mutation);
    const writer = tx ?? this.storage;
    await writer.put<MutationRecord>(MUTATIONS_COLLECTION, entity);
  }

  /**
   * Retrieve pending mutations in sequence number order (INV-1).
   *
   * @param limit - Maximum number of mutations to return.
   * @returns Array of pending mutations, ordered by sequence number.
   */
  async dequeuePending(limit: number): Promise<Mutation[]> {
    const pending = await this.getMutationsByStatus(MUTATION_STATUS.PENDING);
    return pending.slice(0, limit);
  }

  /**
   * Get all mutations for a specific entity, ordered by sequence.
   *
   * @param collectionName - The collection name.
   * @param entityId - The entity ID.
   * @returns Array of mutations for the entity, ordered by sequence.
   */
  async getMutationsForEntity(
    collectionName: string,
    entityId: string,
  ): Promise<Mutation[]> {
    const allMutations = await this.loadAllMutations();
    return allMutations
      .filter(
        (mutation) =>
          mutation.collectionName === collectionName &&
          mutation.entityId === entityId,
      )
      .sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Get the count of mutations with a given status.
   *
   * @param status - The mutation status to count.
   * @returns The number of mutations with the given status.
   */
  async countByStatus(status: MutationStatus): Promise<number> {
    const mutations = await this.getMutationsByStatus(status);
    return mutations.length;
  }

  /**
   * Get the total count of non-terminal mutations
   * (PENDING, IN_FLIGHT, FAILED).
   *
   * @returns The count of active mutations.
   */
  async pendingCount(): Promise<number> {
    const all = await this.loadAllMutations();
    return all.filter(
      (mutation) =>
        mutation.status === MUTATION_STATUS.PENDING ||
        mutation.status === MUTATION_STATUS.IN_FLIGHT ||
        mutation.status === MUTATION_STATUS.FAILED,
    ).length;
  }

  /**
   * Transition a mutation to IN_FLIGHT status.
   *
   * Called by the MutationSender before sending a mutation.
   *
   * @param mutationId - The ID of the mutation to mark as in-flight.
   */
  async markInFlight(mutationId: string): Promise<void> {
    await this.updateMutationStatus(
      mutationId,
      MUTATION_STATUS.IN_FLIGHT,
    );
  }

  /**
   * Transition a mutation to ACKNOWLEDGED status.
   *
   * Called when the server confirms receipt and application.
   *
   * @param mutationId - The ID of the mutation to acknowledge.
   */
  async acknowledge(mutationId: string): Promise<void> {
    await this.updateMutationStatus(
      mutationId,
      MUTATION_STATUS.ACKNOWLEDGED,
    );
  }

  /**
   * Transition a mutation to FAILED status with an error message.
   *
   * @param mutationId - The ID of the mutation.
   * @param errorMessage - The error message describing the failure.
   */
  async markFailed(mutationId: string, errorMessage: string): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated: Entity<MutationRecord> = {
      ...entity,
      data: {
        ...entity.data,
        status: MUTATION_STATUS.FAILED,
        lastError: errorMessage,
      },
      revision: entity.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put<MutationRecord>(MUTATIONS_COLLECTION, updated);
  }

  /**
   * Transition a mutation to CONFLICT status.
   *
   * Called when a conflict is detected that cannot be auto-resolved.
   *
   * @param mutationId - The ID of the mutation.
   * @param errorMessage - Optional error message describing the conflict.
   */
  async markConflict(
    mutationId: string,
    errorMessage?: string,
  ): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated: Entity<MutationRecord> = {
      ...entity,
      data: {
        ...entity.data,
        status: MUTATION_STATUS.CONFLICT,
        lastError: errorMessage ?? null,
      },
      revision: entity.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put<MutationRecord>(MUTATIONS_COLLECTION, updated);
  }

  /**
   * Retry a failed mutation by transitioning it back to IN_FLIGHT
   * and incrementing the retry count.
   *
   * @param mutationId - The ID of the mutation to retry.
   */
  async retry(mutationId: string): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated: Entity<MutationRecord> = {
      ...entity,
      data: {
        ...entity.data,
        status: MUTATION_STATUS.IN_FLIGHT,
        retries: entity.data.retries + 1,
        lastError: null,
      },
      revision: entity.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put<MutationRecord>(MUTATIONS_COLLECTION, updated);
  }

  /**
   * Resolve a conflicted mutation by transitioning it back to PENDING
   * so it can be re-sent in a future sync cycle.
   *
   * Optionally updates the mutation's value and operation to reflect
   * the resolved state (e.g. merged data from a field-merge strategy).
   *
   * @param mutationId - The ID of the conflicted mutation.
   * @param updates - Optional fields to update on the mutation.
   */
  async resolveConflict(
    mutationId: string,
    updates?: {
      readonly value?: unknown;
      readonly operation?: string;
    },
  ): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated: Entity<MutationRecord> = {
      ...entity,
      data: {
        ...entity.data,
        status: MUTATION_STATUS.PENDING,
        retries: entity.data.retries + 1,
        lastError: null,
        ...(updates?.value !== undefined && { value: updates.value }),
        ...(updates?.operation !== undefined && { operation: updates.operation }),
      },
      revision: entity.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put<MutationRecord>(MUTATIONS_COLLECTION, updated);
  }

  /**
   * Get the maximum sequence number for a collection.
   *
   * Used to initialize the MutationRecorder's sequence tracker on startup.
   *
   * @param collectionName - The collection name.
   * @returns The maximum sequence number, or 0 if no mutations exist.
   */
  async getMaxSequence(collectionName: string): Promise<number> {
    const allMutations = await this.loadAllMutations();
    const collectionMutations = allMutations.filter(
      (mutation) => mutation.collectionName === collectionName,
    );
    if (collectionMutations.length === 0) {
      return 0;
    }
    return Math.max(...collectionMutations.map((mutation) => mutation.sequence));
  }

  /**
   * Load all mutations from storage, sorted by sequence number.
   */
  private async loadAllMutations(): Promise<Mutation[]> {
    const emptyQuery = createQuery<MutationRecord>();
    const entities = await this.storage.query<MutationRecord>(
      MUTATIONS_COLLECTION,
      emptyQuery,
    );
    return entities
      .map(entityToMutation)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Update a mutation's status.
   */
  private async updateMutationStatus(
    mutationId: string,
    newStatus: MutationStatus,
  ): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated: Entity<MutationRecord> = {
      ...entity,
      data: {
        ...entity.data,
        status: newStatus,
      },
      revision: entity.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put<MutationRecord>(MUTATIONS_COLLECTION, updated);
  }

  /**
   * Get mutations filtered by status, sorted by sequence.
   */
  private async getMutationsByStatus(
    status: MutationStatus,
  ): Promise<Mutation[]> {
    const allMutations = await this.loadAllMutations();
    return allMutations.filter((mutation) => mutation.status === status);
  }
}
