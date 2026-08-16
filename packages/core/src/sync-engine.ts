/**
 * SyncEngine — orchestrates synchronization cycles.
 *
 * The SyncEngine is the central coordinator that:
 * 1. Picks up pending mutations from the MutationQueue
 * 2. Converts them to protocol types (client → protocol boundary)
 * 3. Sends them via the SyncTransport
 * 4. Applies remote changes from the response (protocol → client boundary)
 * 5. Updates cursors only after all changes are durable (INV-3)
 * 6. Handles conflicts by delegating to a conflict resolver
 * 7. Manages snapshot sync for initial sync and CURSOR_TOO_OLD recovery
 *
 * The SyncEngine does NOT create or manage Collections. It operates
 * on the StorageAdapter and MutationQueue directly.
 */

import type { StorageAdapter } from '@offlinesync/storage';
import type { Mutation, SyncState } from './types/index.js';
import { SYNC_STATE } from './types/index.js';
import type { MutationQueue } from './mutation-queue.js';
import type { SyncTransport } from './sync-transport.js';
import {
  buildSyncRequest,
  extractAcknowledgedIds,
  extractConflictIds,
} from './type-converters.js';
import type {
  SyncResponse,
  SnapshotResponse,
  ConflictInfo,
  SnapshotRequest,
} from '@offlinesync/protocol';
import {
  isSyncResponse,
  isSnapshotResponse,
  SYNC_ERROR_CODE,
} from '@offlinesync/protocol';
import { SyncTransportError } from '@offlinesync/transport-http';
import type { ConflictResolutionManager } from '@offlinesync/conflict';
import type { ConflictContext as ProtocolConflictContext } from '@offlinesync/conflict';

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

/**
 * Configuration options for the SyncEngine.
 */
export interface SyncEngineOptions {
  /** Unique identifier for this client instance. */
  readonly clientId: string;
  /** The storage adapter for persisting entities and cursor. */
  readonly storage: StorageAdapter;
  /** The mutation queue for pending mutations. */
  readonly mutationQueue: MutationQueue;
  /** The transport for communicating with the server. */
  readonly transport: SyncTransport;
  /** Maximum number of mutations to send per sync cycle. */
  readonly batchSize?: number;
  /**
   * Optional conflict resolution manager.
   * When provided, conflicts are automatically resolved
   * using the configured strategies before marking them as CONFLICT.
   */
  readonly conflictResolver?: ConflictResolutionManager;
}

/**
 * Result of a single sync cycle.
 */
export interface SyncCycleResult {
  /** Number of remote changes applied. */
  readonly changesApplied: number;
  /** Number of mutations acknowledged by the server. */
  readonly mutationsAcknowledged: number;
  /** Number of conflicts detected. */
  readonly conflictsDetected: number;
  /** Number of conflicts automatically resolved. */
  readonly conflictsResolved: number;
  /** The new cursor after this sync cycle. */
  readonly newCursor: string;
  /** Whether a snapshot sync was performed. */
  readonly wasSnapshot: boolean;
}

/**
 * Information about a conflict that needs resolution.
 * Passed to the conflict resolution callback.
 */
export interface ConflictEvent {
  /** The conflict info from the server. */
  readonly conflict: ConflictInfo;
  /** The local mutation that caused the conflict. */
  readonly localMutation: Mutation;
}

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const CURSOR_COLLECTION = '__sync_state__';
const CURSOR_KEY = 'cursor';

const DEFAULT_BATCH_SIZE = 100;

// -------------------------------------------------------------------
// SyncEngine
// -------------------------------------------------------------------

/**
 * Orchestrates synchronization between local storage and the server.
 *
 * The engine manages the full sync lifecycle: version negotiation,
 * incremental sync, snapshot sync, conflict detection, and
 * cursor management (INV-3).
 *
 * @example
 * ```typescript
 * const engine = new SyncEngine({
 *   clientId: 'client-001',
 *   storage,
 *   mutationQueue,
 *   transport: httpTransport,
 * });
 *
 * // Perform a sync cycle
 * const result = await engine.sync();
 * ```
 */
export class SyncEngine {
  private readonly clientId: string;
  private readonly storage: StorageAdapter;
  private readonly mutationQueue: MutationQueue;
  private readonly transport: SyncTransport;
  private readonly batchSize: number;
  private readonly conflictResolver: ConflictResolutionManager | undefined;
  private currentSyncState: SyncState = SYNC_STATE.LOCAL_ONLY;
  private conflictCallback: ((event: ConflictEvent) => void) | null = null;

  constructor(options: SyncEngineOptions) {
    this.clientId = options.clientId;
    this.storage = options.storage;
    this.mutationQueue = options.mutationQueue;
    this.transport = options.transport;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.conflictResolver = options.conflictResolver;
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Get the current sync state.
   */
  get syncState(): SyncState {
    return this.currentSyncState;
  }

  /**
   * Register a callback for conflict events.
   *
   * When the server reports a conflict, this callback is invoked
   * with the conflict info and the local mutation. The application
   * can then decide how to resolve it (Phase 7 provides built-in
   * strategies).
   *
   * @param callback - Function called for each conflict.
   */
  onConflict(callback: (event: ConflictEvent) => void): void {
    this.conflictCallback = callback;
  }

  /**
   * Perform a single sync cycle.
   *
   * If no cursor exists, performs a snapshot sync first.
   * Otherwise, performs an incremental sync.
   *
   * @returns The result of the sync cycle.
   */
  async sync(): Promise<SyncCycleResult> {
    this.setSyncState(SYNC_STATE.SYNCING);

    try {
      const cursor = await this.loadCursor();

      if (cursor === '') {
        // Initial sync — use snapshot
        return this.performSnapshotSync();
      }

      return this.performIncrementalSync(cursor);
    } catch (error) {
      this.setSyncState(SYNC_STATE.ERROR);
      throw error;
    }
  }

  /**
   * Force a full snapshot sync, replacing all local data.
   *
   * This is useful for manual re-sync triggers.
   *
   * @param collections - Optional list of collection names to sync.
   *   If omitted, all collections are synced.
   * @returns The result of the snapshot sync.
   */
  async forceSnapshotSync(collections?: string[]): Promise<SyncCycleResult> {
    this.setSyncState(SYNC_STATE.SYNCING);

    try {
      return this.performSnapshotSync(collections);
    } catch (error) {
      this.setSyncState(SYNC_STATE.ERROR);
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // Incremental sync
  // ----------------------------------------------------------------

  private async performIncrementalSync(
    cursor: string,
  ): Promise<SyncCycleResult> {
    const mutations = await this.mutationQueue.dequeuePending(this.batchSize);
    const baseRevisions = await this.loadBaseRevisions(mutations);

    const request = buildSyncRequest(
      cursor,
      mutations,
      baseRevisions,
      this.clientId,
    );

    let response: SyncResponse;
    try {
      response = await this.transport.sendSyncRequest(request);
    } catch (error) {
      // CURSOR_TOO_OLD — auto-recover with snapshot sync
      if (
        error instanceof SyncTransportError &&
        error.code === SYNC_ERROR_CODE.CURSOR_TOO_OLD
      ) {
        // Re-enqueue any dequeued mutations back to PENDING
        for (const mutation of mutations) {
          await this.mutationQueue.retry(mutation.id);
        }
        return this.performSnapshotSync();
      }
      throw error;
    }

    // Validate the response at the boundary
    if (!isSyncResponse(response)) {
      throw new Error('Invalid sync response from server');
    }

    // Apply remote changes and persist cursor atomically (INV-3)
    await this.applySyncResponse(response);

    // Handle acknowledgments
    const acknowledgedIds = extractAcknowledgedIds(response);
    for (const id of acknowledgedIds) {
      await this.mutationQueue.acknowledge(id);
    }

    // Handle conflicts
    const conflictIds = extractConflictIds(response);
    let conflictsResolved = 0;
    for (const conflict of response.conflicts) {
      const resolved = await this.attemptAutoResolve(
        conflict,
        mutations,
      );
      if (resolved) {
        conflictsResolved++;
      } else {
        await this.mutationQueue.markConflict(
          conflict.mutationId,
          `Revision mismatch: client=${conflict.clientRevision}, server=${conflict.serverRevision}`,
        );
        this.notifyConflict(conflict, mutations);
      }
    }

    // Re-enqueue mutations that were sent but NOT acknowledged
    // and NOT in the conflicts list (they may have been lost)
    for (const mutation of mutations) {
      const wasAcknowledged = acknowledgedIds.includes(mutation.id);
      const wasConflicted = conflictIds.includes(mutation.id);
      if (!wasAcknowledged && !wasConflicted) {
        // Mutation was in-flight but not acknowledged — put back to PENDING
        await this.mutationQueue.retry(mutation.id);
      }
    }

    this.setSyncState(SYNC_STATE.SYNCED);

    return {
      changesApplied: response.changes.length,
      mutationsAcknowledged: acknowledgedIds.length,
      conflictsDetected: response.conflicts.length,
      conflictsResolved,
      newCursor: response.newCursor,
      wasSnapshot: false,
    };
  }

  // ----------------------------------------------------------------
  // Snapshot sync
  // ----------------------------------------------------------------

  private async performSnapshotSync(
    collections?: string[],
  ): Promise<SyncCycleResult> {
    const request: SnapshotRequest = {
      clientId: this.clientId,
      ...(collections !== undefined && { collections }),
    };

    const response = await this.transport.sendSnapshotRequest(request);

    if (!isSnapshotResponse(response)) {
      throw new Error('Invalid snapshot response from server');
    }

    await this.applySnapshotResponse(response);

    this.setSyncState(SYNC_STATE.SYNCED);

    return {
      changesApplied: this.countSnapshotEntities(response),
      mutationsAcknowledged: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
      newCursor: response.cursor,
      wasSnapshot: true,
    };
  }

  // ----------------------------------------------------------------
  // Conflict auto-resolution
  // ----------------------------------------------------------------

  /**
   * Attempt to auto-resolve a conflict using the ConflictResolutionManager.
   *
   * If resolved:
   * 1. Applies the resolved data to local storage
   * 2. Re-enqueues the mutation with updated value
   * 3. Returns true
   *
   * If no resolver is configured or resolution fails, returns false.
   */
  private async attemptAutoResolve(
    conflict: ConflictInfo,
    mutations: readonly Mutation[],
  ): Promise<boolean> {
    if (this.conflictResolver === undefined) return false;

    const localMutation = mutations.find(
      (m) => m.id === conflict.mutationId,
    );
    if (localMutation === undefined) return false;

    // Build the conflict context
    let localEntity: ProtocolConflictContext['localEntity'];
    try {
      const entity = await this.storage.get<unknown>(
        conflict.collectionName,
        conflict.entityId,
      );
      localEntity = {
        id: entity.id,
        data: entity.data,
        revision: entity.revision,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        isDeleted: entity.isDeleted,
      };
    } catch {
      localEntity = undefined;
    }

    const context: ProtocolConflictContext = {
      conflict,
      localMutation: {
        id: localMutation.id,
        operation: localMutation.operation,
        field: localMutation.field,
        value: localMutation.value,
        createdAt: localMutation.createdAt,
      },
      localEntity,
      serverEntity: conflict.serverEntity,
      collectionName: conflict.collectionName,
    };

    const resolution = this.conflictResolver.resolve(context);
    if (!resolution.resolved) return false;

    // Apply resolved data locally
    const now = new Date().toISOString();
    await this.storage.put(conflict.collectionName, {
      id: conflict.entityId,
      data: resolution.resolvedData,
      revision: conflict.serverRevision,
      createdAt: conflict.serverEntity.createdAt,
      updatedAt: now,
      isDeleted: conflict.serverEntity.isDeleted,
    });

    // Re-enqueue the mutation with the resolved value
    await this.mutationQueue.resolveConflict(conflict.mutationId, {
      value: resolution.resolvedData,
      operation: 'set',
    });

    return true;
  }

  // ----------------------------------------------------------------
  // Applying remote changes
  // ----------------------------------------------------------------

  /**
   * Apply changes from a SyncResponse to local storage.
   *
   * Changes are applied in a transaction. The cursor is advanced
   * ONLY AFTER all changes are written (INV-3).
   */
  private async applySyncResponse(response: SyncResponse): Promise<void> {
    if (response.changes.length === 0) {
      // No changes to apply, but still advance cursor
      await this.saveCursor(response.newCursor);
      return;
    }

    // Group changes by collection name for batch storage
    const byCollection = this.groupChangesByCollection(response);

    // Apply all changes, then advance cursor (INV-3)
    await this.storage.transaction(async (tx) => {
      for (const [collectionName, changes] of byCollection) {
        for (const change of changes) {
          await tx.put(collectionName, {
            id: change.entity.id,
            data: change.entity.data,
            revision: change.entity.revision,
            createdAt: change.entity.createdAt,
            updatedAt: change.entity.updatedAt,
            isDeleted: change.entity.isDeleted,
          });
        }
      }
    });

    // Cursor advances ONLY after the transaction commits (INV-3)
    await this.saveCursor(response.newCursor);
  }

  /**
   * Apply a snapshot response, replacing local state.
   */
  private async applySnapshotResponse(
    response: SnapshotResponse,
  ): Promise<void> {
    await this.storage.transaction(async (tx) => {
      for (const [collectionName, entities] of Object.entries(response.entities)) {
        for (const entity of entities) {
          const proto = entity as {
            id: string;
            data: unknown;
            revision: number;
            createdAt: string;
            updatedAt: string;
            isDeleted: boolean;
          };
          await tx.put(collectionName, {
            id: proto.id,
            data: proto.data,
            revision: proto.revision,
            createdAt: proto.createdAt,
            updatedAt: proto.updatedAt,
            isDeleted: proto.isDeleted,
          });
        }
      }
    });

    // Cursor advances after all snapshot data is durable (INV-3)
    await this.saveCursor(response.cursor);
  }

  // ----------------------------------------------------------------
  // Cursor management (INV-3)
  // ----------------------------------------------------------------

  /**
   * Load the current cursor from storage.
   *
   * Returns empty string if no cursor has been stored yet.
   */
  private async loadCursor(): Promise<string> {
    try {
      const entity = await this.storage.get<{ value: string }>(
        CURSOR_COLLECTION,
        CURSOR_KEY,
      );
      return entity.data.value;
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'NOT_FOUND'
      ) {
        return '';
      }
      throw error;
    }
  }

  /**
   * Save the cursor to storage.
   *
   * This should only be called AFTER all changes are durable.
   */
  private async saveCursor(cursor: string): Promise<void> {
    const now = new Date().toISOString();
    await this.storage.put(CURSOR_COLLECTION, {
      id: CURSOR_KEY,
      data: { value: cursor },
      revision: 1,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Load base revisions for a set of mutations.
   *
   * For each mutation, we need the entity's current revision
   * to send as baseRevision for conflict detection.
   */
  private async loadBaseRevisions(
    mutations: readonly Mutation[],
  ): Promise<Map<string, number>> {
    const revisions = new Map<string, number>();
    const entityIds = new Set(mutations.map((m) => m.entityId));

    for (const entityId of entityIds) {
      // Find the collection name from any mutation targeting this entity
      const mutation = mutations.find((m) => m.entityId === entityId);
      if (mutation === undefined) continue;

      try {
        const entity = await this.storage.get<unknown>(
          mutation.collectionName,
          entityId,
        );
        revisions.set(entityId, entity.revision);
      } catch (error) {
        if (
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code: string }).code === 'NOT_FOUND'
        ) {
          // Entity was deleted locally — use revision 0
          revisions.set(entityId, 0);
        } else {
          throw error;
        }
      }
    }

    return revisions;
  }

  /**
   * Group changes by collection name for batch application.
   */
  private groupChangesByCollection(
    response: SyncResponse,
  ): Map<string, typeof response.changes> {
    const map = new Map<string, typeof response.changes>();
    for (const change of response.changes) {
      const existing = map.get(change.collectionName);
      if (existing !== undefined) {
        existing.push(change);
      } else {
        map.set(change.collectionName, [change]);
      }
    }
    return map;
  }

  /**
   * Notify the conflict callback about a detected conflict.
   */
  private notifyConflict(
    conflict: ConflictInfo,
    mutations: readonly Mutation[],
  ): void {
    if (this.conflictCallback === null) return;

    const localMutation = mutations.find(
      (m) => m.id === conflict.mutationId,
    );
    if (localMutation === undefined) return;

    this.conflictCallback({ conflict, localMutation });
  }

  /**
   * Count total entities in a snapshot response.
   */
  private countSnapshotEntities(response: SnapshotResponse): number {
    let count = 0;
    for (const entities of Object.values(response.entities)) {
      count += entities.length;
    }
    return count;
  }

  /**
   * Update the sync state and emit change events.
   */
  private setSyncState(state: SyncState): void {
    this.currentSyncState = state;
  }
}
