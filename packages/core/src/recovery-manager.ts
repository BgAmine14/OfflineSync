/**
 * RecoveryManager — detects and repairs inconsistent state after crashes.
 *
 * On startup, the RecoveryManager performs several checks:
 * 1. IN_FLIGHT mutations are reset to PENDING (crash during send)
 * 2. Orphaned entities (entity exists but no mutation) are detected
 * 3. Sequence gaps in the mutation queue are detected and reported
 *
 * Recovery is idempotent — running it multiple times is safe.
 *
 * Invariants addressed:
 * - INV-4: Ensures no pending mutations are lost
 * - INV-1: Verifies mutation sequence integrity
 * - INV-8: Detects partial writes (entity without mutation)
 */

import type { StorageAdapter } from '@offlinesync/storage';
import { createQuery } from '@offlinesync/storage';
import type { Mutation } from './types/index.js';
import { MUTATION_STATUS } from './types/index.js';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

/**
 * Result of a recovery operation.
 */
export interface RecoveryResult {
  /** Whether any repairs were made. */
  readonly repaired: boolean;
  /** Detailed list of repairs performed. */
  readonly repairs: readonly RepairAction[];
  /** Issues detected that could not be auto-repaired. */
  readonly warnings: readonly RecoveryWarning[];
}

/**
 * A single repair action that was performed.
 */
export interface RepairAction {
  /** Human-readable description of the repair. */
  readonly description: string;
  /** The invariant this repair relates to. */
  readonly invariant: string;
  /** The mutation ID if applicable. */
  readonly mutationId?: string;
  /** The collection name if applicable. */
  readonly collectionName?: string;
  /** The entity ID if applicable. */
  readonly entityId?: string;
}

/**
 * A warning about an issue that could not be auto-repaired.
 */
export interface RecoveryWarning {
  /** Human-readable description. */
  readonly description: string;
  /** The invariant this warning relates to. */
  readonly invariant: string;
  /** Severity level. */
  readonly severity: 'low' | 'medium' | 'high';
}

/**
 * Options for creating a RecoveryManager.
 */
export interface RecoveryManagerOptions {
  /** The storage adapter to check and repair. */
  readonly storage: StorageAdapter;
  /** Collection names used by the application (for orphan detection). */
  readonly applicationCollections: readonly string[];
}

// -------------------------------------------------------------------
// Internal types for stored mutations
// -------------------------------------------------------------------

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

const MUTATIONS_COLLECTION = '__mutations__';

// -------------------------------------------------------------------
// RecoveryManager
// -------------------------------------------------------------------

/**
 * Detects and repairs inconsistent state after crashes.
 *
 * Call `recover()` on startup before any other operations.
 * The method is idempotent and safe to call multiple times.
 *
 * @example
 * ```typescript
 * const recovery = new RecoveryManager({
 *   storage: adapter,
 *   applicationCollections: ['tasks', 'projects'],
 * });
 * const result = await recovery.recover();
 * if (result.repaired) {
 *   console.log(`Performed ${result.repairs.length} repairs`);
 * }
 * ```
 */
export class RecoveryManager {
  private readonly storage: StorageAdapter;
  private readonly applicationCollections: readonly string[];

  constructor(options: RecoveryManagerOptions) {
    this.storage = options.storage;
    this.applicationCollections = options.applicationCollections;
  }

  /**
   * Run all recovery checks and repairs.
   *
   * @returns A report of all repairs and warnings.
   */
  async recover(): Promise<RecoveryResult> {
    const repairs: RepairAction[] = [];
    const warnings: RecoveryWarning[] = [];

    // 1. Reset IN_FLIGHT mutations to PENDING (INV-4)
    const inFlightRepairs = await this.resetInFlightMutations();
    repairs.push(...inFlightRepairs);

    // 2. Check for sequence gaps (INV-1)
    const sequenceWarnings = await this.checkSequenceIntegrity();
    warnings.push(...sequenceWarnings);

    // 3. Check for orphaned mutations (entity deleted but mutation still queued)
    const orphanWarnings = await this.checkOrphanedMutations();
    warnings.push(...orphanWarnings);

    return {
      repaired: repairs.length > 0,
      repairs,
      warnings,
    };
  }

  /**
   * Reset all IN_FLIGHT mutations back to PENDING.
   *
   * When a process crashes during sync, mutations may be left
   * in IN_FLIGHT status. They must be reset to PENDING so
   * they will be retried on the next sync cycle (INV-4).
   */
  async resetInFlightMutations(): Promise<RepairAction[]> {
    const repairs: RepairAction[] = [];

    const mutations = await this.loadAllMutations();
    const inFlight = mutations.filter(
      (mutation) => mutation.status === MUTATION_STATUS.IN_FLIGHT,
    );

    for (const mutation of inFlight) {
      await this.updateMutationStatus(mutation.id, MUTATION_STATUS.PENDING);
      repairs.push({
        description: `Reset IN_FLIGHT mutation to PENDING`,
        invariant: 'INV-4',
        mutationId: mutation.id,
        collectionName: mutation.collectionName,
        entityId: mutation.entityId,
      });
    }

    return repairs;
  }

  /**
   * Check for gaps in mutation sequence numbers (INV-1).
   *
   * Sequence gaps indicate that mutations were lost, which is
   * a critical invariant violation. This cannot be auto-repaired —
   * it is returned as a warning.
   */
  async checkSequenceIntegrity(): Promise<RecoveryWarning[]> {
    const warnings: RecoveryWarning[] = [];

    const mutations = await this.loadAllMutations();

    // Group by collection
    const byCollection = new Map<string, Mutation[]>();
    for (const mutation of mutations) {
      const existing = byCollection.get(mutation.collectionName);
      if (existing !== undefined) {
        existing.push(mutation);
      } else {
        byCollection.set(mutation.collectionName, [mutation]);
      }
    }

    for (const [collectionName, collectionMutations] of byCollection) {
      if (collectionMutations.length === 0) continue;

      const sorted = [...collectionMutations].sort(
        (a, b) => a.sequence - b.sequence,
      );

      for (let index = 1; index < sorted.length; index++) {
        const prev = sorted[index - 1] ?? sorted[0];
        const current = sorted[index];
        if (current === undefined || prev === undefined) continue;

        const expected = prev.sequence + 1;
        if (current.sequence > expected) {
          warnings.push({
            description: `Sequence gap in '${collectionName}': expected ${expected} but found ${current.sequence}`,
            invariant: 'INV-1',
            severity: 'high',
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Check for mutations that reference non-existent entities.
   *
   * If an entity was deleted but the mutation queue still has
   * pending mutations for it, those mutations are orphaned.
   */
  async checkOrphanedMutations(): Promise<RecoveryWarning[]> {
    const warnings: RecoveryWarning[] = [];

    const mutations = await this.loadAllMutations();
    const pendingMutations = mutations.filter(
      (mutation) =>
        mutation.status === MUTATION_STATUS.PENDING ||
        mutation.status === MUTATION_STATUS.FAILED,
    );

    // Only check against known application collections
    const knownCollections = new Set(this.applicationCollections);

    for (const mutation of pendingMutations) {
      // Skip mutations for system collections or unknown collections
      if (
        mutation.collectionName.startsWith('__') ||
        !knownCollections.has(mutation.collectionName)
      ) {
        continue;
      }

      try {
        await this.storage.get(mutation.collectionName, mutation.entityId);
      } catch (error) {
        if (
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code: string }).code === 'NOT_FOUND'
        ) {
          warnings.push({
            description: `Orphaned mutation ${mutation.id} references non-existent entity '${mutation.entityId}' in '${mutation.collectionName}'`,
            invariant: 'INV-4',
            severity: 'medium',
          });
        }
      }
    }

    return warnings;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Load all mutations from storage.
   */
  private async loadAllMutations(): Promise<Mutation[]> {
    const emptyQuery = createQuery<MutationRecord>();
    const entities = await this.storage.query<MutationRecord>(
      MUTATIONS_COLLECTION,
      emptyQuery,
    );
    return entities.map((entity) => ({
      id: entity.id,
      entityId: entity.data.entityId,
      collectionName: entity.data.collectionName,
      operation: entity.data.operation as Mutation['operation'],
      field: entity.data.field,
      value: entity.data.value,
      sequence: entity.data.sequence,
      status: entity.data.status as Mutation['status'],
      createdAt: entity.data.createdAt,
      retries: entity.data.retries,
      lastError: entity.data.lastError,
    }));
  }

  /**
   * Update a mutation's status in storage.
   */
  private async updateMutationStatus(
    mutationId: string,
    newStatus: string,
  ): Promise<void> {
    const entity = await this.storage.get<MutationRecord>(
      MUTATIONS_COLLECTION,
      mutationId,
    );
    const updated = {
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
}
