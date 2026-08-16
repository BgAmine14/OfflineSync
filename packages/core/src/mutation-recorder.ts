/**
 * MutationRecorder — creates mutation records for local writes.
 *
 * Every local write to an entity creates exactly one mutation.
 * The recorder assigns monotonically increasing sequence numbers
 * per collection (INV-1) and generates UUIDv7 mutation IDs.
 *
 * The MutationRecorder does NOT persist mutations itself —
 * it creates the Mutation object which is then stored by the
 * MutationQueue within the same atomic transaction (INV-8).
 */

import type { Entity } from '@offlinesync/storage';
import type { Mutation, OperationType } from './types/index.js';
import { MUTATION_STATUS, OPERATION_TYPE } from './types/index.js';

/**
 * Callback that generates a UUIDv7 string.
 * Injected to allow different UUIDv7 implementations.
 */
export interface IdGenerator {
  /** Generate a new UUIDv7 string. */
  generate(): string;
}

/**
 * Records of the next sequence number per collection.
 * Used to ensure monotonically increasing sequences (INV-1).
 */
class SequenceTracker {
  private readonly nextSequenceByCollection = new Map<string, number>();

  /**
 * Get and increment the next sequence number for a collection.
 *
 * @param collectionName - The collection name.
 * @returns The next sequence number.
 */
  next(collectionName: string): number {
    const current = this.nextSequenceByCollection.get(collectionName) ?? 0;
    const next = current + 1;
    this.nextSequenceByCollection.set(collectionName, next);
    return next;
  }

  /**
 * Get the current (last assigned) sequence number for a collection.
 *
 * @param collectionName - The collection name.
 * @returns The last assigned sequence number, or 0 if none.
 */
  current(collectionName: string): number {
    return this.nextSequenceByCollection.get(collectionName) ?? 0;
  }

  /**
 * Initialize the sequence tracker from the maximum existing
   * sequence number (used when loading from durable storage).
   *
 * @param collectionName - The collection name.
 * @param maxSequence - The highest sequence number already in use.
 */
  initialize(collectionName: string, maxSequence: number): void {
    const current = this.nextSequenceByCollection.get(collectionName) ?? 0;
    if (maxSequence > current) {
      this.nextSequenceByCollection.set(collectionName, maxSequence);
    }
  }
}

/**
 * Options for creating a MutationRecorder.
 */
export interface MutationRecorderOptions {
  /**
   * ID generator for mutation IDs.
   * Must produce UUIDv7 strings for time-sortability.
   */
  readonly idGenerator: IdGenerator;
}

/**
 * Creates mutation records for local writes.
 *
 * The recorder tracks monotonically increasing sequence numbers
 * per collection (INV-1) and produces Mutation objects that are
 * then stored by the MutationQueue.
 *
 * Usage: The recorder is called within Collection write operations
 * to create a Mutation for every local write. The mutation and the
 * entity update are stored atomically (INV-8).
 *
 * @example
 * ```typescript
 * const recorder = new MutationRecorder({ idGenerator: uuidv7Generator });
 * const mutation = recorder.recordCreate('tasks', entity);
 * // mutation is then stored alongside the entity in a transaction
 * ```
 */
export class MutationRecorder {
  private readonly idGenerator: IdGenerator;
  private readonly sequenceTracker = new SequenceTracker();

  constructor(options: MutationRecorderOptions) {
    this.idGenerator = options.idGenerator;
  }

  /**
   * Record a 'set' operation — replacing the entire entity data.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entity - The entity after the write.
   * @returns A Mutation record for the set operation.
   */
  recordSet<T>(
    collectionName: string,
    entity: Entity<T>,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entity.id,
      OPERATION_TYPE.SET,
      null,
      entity.data,
    );
  }

  /**
   * Record a 'patch' operation — merging partial data.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entityId - The entity's unique identifier.
   * @param patchData - The partial data to merge.
   * @returns A Mutation record for the patch operation.
   */
  recordPatch<T>(
    collectionName: string,
    entityId: string,
    patchData: Partial<T>,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entityId,
      OPERATION_TYPE.PATCH,
      null,
      patchData,
    );
  }

  /**
   * Record a 'delete' operation — soft-deleting an entity.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entity - The soft-deleted entity.
   * @returns A Mutation record for the delete (set with isDeleted=true) operation.
   */
  recordDelete<T>(
    collectionName: string,
    entity: Entity<T>,
  ): Mutation {
    // A delete is modeled as a 'set' with the full entity data
    // where isDeleted is true. This ensures the server has the
    // complete entity state to apply the deletion deterministically.
    return this.createMutation(
      collectionName,
      entity.id,
      OPERATION_TYPE.SET,
      null,
      entity.data,
    );
  }

  /**
   * Record an 'increment' operation on a numeric field.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entityId - The entity's unique identifier.
   * @param field - The numeric field to increment.
   * @param amount - The amount to add.
   * @returns A Mutation record for the increment operation.
   */
  recordIncrement(
    collectionName: string,
    entityId: string,
    field: string,
    amount: number,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entityId,
      OPERATION_TYPE.INCREMENT,
      field,
      amount,
    );
  }

  /**
   * Record a 'decrement' operation on a numeric field.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entityId - The entity's unique identifier.
   * @param field - The numeric field to decrement.
   * @param amount - The amount to subtract.
   * @returns A Mutation record for the decrement operation.
   */
  recordDecrement(
    collectionName: string,
    entityId: string,
    field: string,
    amount: number,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entityId,
      OPERATION_TYPE.DECREMENT,
      field,
      amount,
    );
  }

  /**
   * Record an 'add' operation on an array field.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entityId - The entity's unique identifier.
   * @param field - The array field to add to.
   * @param item - The item to add.
   * @returns A Mutation record for the add operation.
   */
  recordAdd(
    collectionName: string,
    entityId: string,
    field: string,
    item: unknown,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entityId,
      OPERATION_TYPE.ADD,
      field,
      item,
    );
  }

  /**
   * Record a 'remove' operation on an array field.
   *
   * @param collectionName - The collection the entity belongs to.
   * @param entityId - The entity's unique identifier.
   * @param field - The array field to remove from.
   * @param item - The item to remove.
   * @returns A Mutation record for the remove operation.
   */
  recordRemove(
    collectionName: string,
    entityId: string,
    field: string,
    item: unknown,
  ): Mutation {
    return this.createMutation(
      collectionName,
      entityId,
      OPERATION_TYPE.REMOVE,
      field,
      item,
    );
  }

  /**
   * Initialize the sequence tracker for a collection from a known
   * maximum sequence number. This is used when loading existing
   * mutations from durable storage on startup.
   *
   * @param collectionName - The collection name.
   * @param maxSequence - The highest sequence number in storage.
   */
  initializeSequence(collectionName: string, maxSequence: number): void {
    this.sequenceTracker.initialize(collectionName, maxSequence);
  }

  /**
   * Get the current (last assigned) sequence number for a collection.
   *
   * @param collectionName - The collection name.
   * @returns The last assigned sequence number, or 0 if none.
   */
  getCurrentSequence(collectionName: string): number {
    return this.sequenceTracker.current(collectionName);
  }

  /**
   * Create a mutation with the next sequence number.
   */
  private createMutation(
    collectionName: string,
    entityId: string,
    operation: OperationType,
    field: string | null,
    value: unknown,
  ): Mutation {
    const sequence = this.sequenceTracker.next(collectionName);
    return {
      id: this.idGenerator.generate(),
      entityId,
      collectionName,
      operation,
      field,
      value,
      sequence,
      status: MUTATION_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      retries: 0,
      lastError: null,
    };
  }
}
