import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
  ProtocolMutation,
  ProtocolEntity,
  ProtocolError,
  Change,
  ConflictInfo,
} from '@offlinesync/protocol';
import { SYNC_ERROR_CODE } from '@offlinesync/protocol';
import { ServerChangeLog } from './change-log.js';
import type { ChangeLogEntry } from './change-log.js';
import { ServerMutationTracker } from './mutation-tracker.js';

/**
 * Internal entity storage: collectionName → entityId → ProtocolEntity.
 */
type EntityStore = Map<string, Map<string, ProtocolEntity>>;

/**
 * Result of processing a single mutation.
 */
interface MutationResult {
  readonly acknowledged: boolean;
  readonly conflict?: ConflictInfo;
  readonly changeLogEntry?: Omit<ChangeLogEntry, 'serverSequence'>;
}

/**
 * In-memory reference sync server for OfflineSync.
 *
 * This is a reference implementation for testing and documentation.
 * It stores entities in memory, maintains an append-only change log
 * with global server sequences, and deduplicates mutations (INV-5).
 *
 * - Server sequences are global log positions, NOT entity revisions (INV-6).
 * - Mutation deduplication ensures idempotency (INV-5).
 * - Cursor-based sync with minimumAvailableCursor for log pruning.
 */
export class SyncServer {
  private readonly entities: EntityStore = new Map();
  private readonly changeLog = new ServerChangeLog();
  private readonly mutationTracker = new ServerMutationTracker();

  /**
   * The current server cursor (latest server sequence as string).
   */
  get currentCursor(): string {
    return this.changeLog.currentCursor;
  }

  /**
   * The minimum available cursor for incremental sync.
   * Clients with cursors older than this must perform a snapshot sync.
   */
  get minimumAvailableCursor(): string {
    return this.changeLog.minimumAvailableCursor;
  }

  /**
   * Get the change log (for testing/inspection).
   */
  getChangeLog(): Readonly<ServerChangeLog> {
    return this.changeLog;
  }

  /**
   * Get the mutation tracker (for testing/inspection).
   */
  getMutationTracker(): Readonly<ServerMutationTracker> {
    return this.mutationTracker;
  }

  /**
   * Get the number of entities stored across all collections.
   */
  get entityCount(): number {
    let count = 0;
    for (const collection of this.entities.values()) {
      count += collection.size;
    }
    return count;
  }

  /**
   * Handle an incremental sync request.
   *
 * Processes the client's mutations, detects conflicts, and returns
   * changes since the client's cursor.
   *
   * @param request - The incremental sync request
   * @returns The sync response, or a protocol error
   */
  handleSyncRequest(request: SyncRequest): SyncResponse | ProtocolError {
    const { cursor, mutations } = request;

    // Check for CURSOR_TOO_OLD
    if (cursor !== '' && this.changeLog.isCursorTooOld(cursor)) {
      return {
        code: SYNC_ERROR_CODE.CURSOR_TOO_OLD,
        message:
          'Client cursor is too old. Minimum available cursor: ' +
          this.changeLog.minimumAvailableCursor,
        details: {
          minimumAvailableCursor: this.changeLog.minimumAvailableCursor,
        },
      };
    }

    // Process mutations
    const acknowledgedMutationIds: string[] = [];
    const conflicts: ConflictInfo[] = [];

    for (const mutation of mutations) {
      const result = this.processMutation(mutation);

      if (result.conflict !== undefined) {
        conflicts.push(result.conflict);
      }

      if (result.acknowledged) {
        acknowledgedMutationIds.push(mutation.id);
      }

      if (result.changeLogEntry !== undefined) {
        const serverSequence = this.changeLog.append(result.changeLogEntry);
        this.mutationTracker.record(mutation.id, serverSequence);
      }
    }

    // Get changes since cursor
    const effectiveCursor = cursor === '' ? '0' : cursor;
    const logEntries = this.changeLog.getChangesSince(effectiveCursor);
    const changes: Change[] = logEntries.map((entry) => ({
      serverSequence: entry.serverSequence,
      collectionName: entry.collectionName,
      entity: entry.entity,
      operation: entry.operation,
      field: entry.field,
      value: entry.value,
    }));

    return {
      changes,
      acknowledgedMutationIds,
      conflicts,
      newCursor: this.changeLog.currentCursor,
    };
  }

  /**
   * Handle a snapshot sync request.
   *
   * Returns all current entity states, optionally filtered by collection.
   *
   * @param request - The snapshot sync request
   * @returns The snapshot response
   */
  handleSnapshotRequest(request: SnapshotRequest): SnapshotResponse {
    const collections = request.collections;
    const entities: Record<string, unknown[]> = {};

    const collectionNames =
      collections !== undefined && collections.length > 0
        ? collections
        : Array.from(this.entities.keys());

    for (const name of collectionNames) {
      const collection = this.entities.get(name);
      if (collection !== undefined) {
        entities[name] = Array.from(collection.values());
      } else {
        entities[name] = [];
      }
    }

    return {
      entities,
      cursor: this.changeLog.currentCursor,
      serverTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Set the minimum available cursor and prune the change log and mutation tracker.
   *
   * @param cursorValue - The new minimum available cursor
   */
  setMinimumAvailableCursor(cursorValue: string): void {
    this.changeLog.setMinimumAvailableCursor(cursorValue);
    const seq = Number(cursorValue);
    if (!Number.isNaN(seq)) {
      this.mutationTracker.pruneBelowSequence(seq);
    }
  }

  /**
   * Insert an entity directly into the server's store.
   * Useful for seeding test data.
   *
   * @param collectionName - The collection to insert into
   * @param entity - The entity to insert
   * @param operation - The operation that produced this entity (default: 'set')
   * @param field - The field modified (default: null)
   * @param value - The operation value (default: entity.data)
   */
  seedEntity(
    collectionName: string,
    entity: ProtocolEntity,
    operation = 'set',
    field: string | null = null,
    value: unknown = undefined,
  ): void {
    const resolvedValue = value !== undefined ? value : entity.data;
    this.getOrCreateCollection(collectionName).set(entity.id, entity);
    this.changeLog.append({
      collectionName,
      entityId: entity.id,
      entity,
      operation,
      field,
      value: resolvedValue,
    });
  }

  /**
   * Process a single mutation: dedup check, conflict check, apply.
   */
  private processMutation(mutation: ProtocolMutation): MutationResult {
    // INV-5: Deduplication
    if (this.mutationTracker.has(mutation.id)) {
      return { acknowledged: true };
    }

    const collection = this.entities.get(mutation.collectionName);
    const existing =
      collection !== undefined
        ? collection.get(mutation.entityId)
        : undefined;

    // Conflict detection (INV-2)
    if (existing !== undefined) {
      if (mutation.baseRevision !== existing.revision) {
        return {
          acknowledged: false,
          conflict: {
            mutationId: mutation.id,
            entityId: mutation.entityId,
            collectionName: mutation.collectionName,
            clientRevision: mutation.baseRevision,
            serverRevision: existing.revision,
            serverEntity: existing,
          },
        };
      }
    } else {
      // Entity doesn't exist; baseRevision must be 0 for a new entity
      if (mutation.baseRevision !== 0) {
        return {
          acknowledged: false,
          conflict: {
            mutationId: mutation.id,
            entityId: mutation.entityId,
            collectionName: mutation.collectionName,
            clientRevision: mutation.baseRevision,
            serverRevision: 0,
            serverEntity: {
              id: mutation.entityId,
              data: {},
              revision: 0,
              createdAt: '',
              updatedAt: '',
              isDeleted: true,
            },
          },
        };
      }
    }

    // Apply the mutation
    const now = new Date().toISOString();
    let entity: ProtocolEntity;

    if (existing !== undefined) {
      entity = applyMutation(existing, mutation, now);
    } else {
      // Create new entity, then apply mutation
      const newEntity: ProtocolEntity = {
        id: mutation.entityId,
        data: {},
        revision: 0,
        createdAt: mutation.createdAt,
        updatedAt: now,
        isDeleted: false,
      };
      entity = applyMutation(newEntity, mutation, now);
    }

    // Store the entity
    this.getOrCreateCollection(mutation.collectionName).set(
      mutation.entityId,
      entity,
    );

    return {
      acknowledged: true,
      changeLogEntry: {
        collectionName: mutation.collectionName,
        entityId: mutation.entityId,
        entity,
        operation: mutation.operation,
        field: mutation.field,
        value: mutation.value,
      },
    };
  }

  private getOrCreateCollection(name: string): Map<string, ProtocolEntity> {
    let collection = this.entities.get(name);
    if (collection === undefined) {
      collection = new Map();
      this.entities.set(name, collection);
    }
    return collection;
  }
}

/**
 * Apply a mutation to an entity, producing the updated entity.
 *
 * Handles all operation types: set, patch, increment, decrement, add, remove.
 */
function applyMutation(
  entity: ProtocolEntity,
  mutation: ProtocolMutation,
  now: string,
): ProtocolEntity {
  let newData: Record<string, unknown>;

  switch (mutation.operation) {
    case 'set':
      newData = (mutation.value ?? {}) as Record<string, unknown>;
      break;

    case 'patch':
      newData = {
        ...(entity.data as Record<string, unknown>),
        ...(mutation.value as Record<string, unknown>),
      };
      break;

    case 'increment': {
      newData = { ...(entity.data as Record<string, unknown>) };
      if (mutation.field !== null) {
        const current = newData[mutation.field];
        const currentNum = typeof current === 'number' ? current : 0;
        newData[mutation.field] =
          currentNum + ((mutation.value as number) ?? 0);
      }
      break;
    }

    case 'decrement': {
      newData = { ...(entity.data as Record<string, unknown>) };
      if (mutation.field !== null) {
        const current = newData[mutation.field];
        const currentNum = typeof current === 'number' ? current : 0;
        newData[mutation.field] =
          currentNum - ((mutation.value as number) ?? 0);
      }
      break;
    }

    case 'add': {
      newData = { ...(entity.data as Record<string, unknown>) };
      if (mutation.field !== null) {
        const current = newData[mutation.field];
        const arr =
          Array.isArray(current) ? [...current] : [];
        arr.push(mutation.value);
        newData[mutation.field] = arr;
      }
      break;
    }

    case 'remove': {
      newData = { ...(entity.data as Record<string, unknown>) };
      if (mutation.field !== null) {
        const current = newData[mutation.field];
        if (Array.isArray(current)) {
          newData[mutation.field] = current.filter(
            (item) => item !== mutation.value,
          );
        }
      }
      break;
    }

    default:
      // Unknown operation: treat as no-op on data
      newData = { ...(entity.data as Record<string, unknown>) };
      break;
  }

  return {
    ...entity,
    data: newData,
    revision: entity.revision + 1,
    updatedAt: now,
  };
}
