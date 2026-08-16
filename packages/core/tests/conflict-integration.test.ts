/**
 * Integration tests for the full conflict resolution flow:
 * ConflictResolutionManager → SyncEngine → StorageAdapter.
 *
 * These tests verify that conflicts are properly detected, resolved,
 * and the resolved state is persisted back to storage. They also
 * verify that the onConflict callback fires for unresolved conflicts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { SyncEngine } from '../src/sync-engine.js';
import { StubSyncTransport } from '../src/sync-transport.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { MUTATION_STATUS } from '../src/types/index.js';
import {
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
  OperationAwareStrategy,
  FunctionStrategy,
  FieldMergeStrategy,
  LastWriteWinsStrategy,
  RESOLUTION_OUTCOME,
} from '@offlinesync/conflict';
import type { Mutation } from '../src/types/index.js';

const validTimestamp = '2026-08-14T10:00:00Z';
const tsNewer = '2026-08-14T11:00:00Z';
const tsOlder = '2026-08-14T09:00:00Z';

async function makeQueue(storage: InMemoryStorageAdapter): Promise<MutationQueue> {
  return new MutationQueue({ storage });
}

async function enqueueMutation(
  queue: MutationQueue,
  overrides?: Partial<Mutation>,
): Promise<Mutation> {
  const mutation: Mutation = {
    id: overrides?.id ?? 'mut-001',
    entityId: overrides?.entityId ?? 'entity-001',
    collectionName: overrides?.collectionName ?? 'tasks',
    operation: overrides?.operation ?? 'set',
    field: overrides?.field ?? null,
    value: overrides?.value ?? { title: 'Test' },
    sequence: overrides?.sequence ?? 1,
    status: MUTATION_STATUS.PENDING,
    createdAt: overrides?.createdAt ?? validTimestamp,
    retries: overrides?.retries ?? 0,
    lastError: overrides?.lastError ?? null,
  };
  await queue.enqueue(mutation);
  return mutation;
}

async function seedEntity(
  storage: InMemoryStorageAdapter,
  collectionName: string,
  id: string,
  data: unknown,
  revision: number,
): Promise<void> {
  await storage.put(collectionName, {
    id,
    data,
    revision,
    createdAt: validTimestamp,
    updatedAt: validTimestamp,
    isDeleted: false,
  });
}

async function seedCursor(
  storage: InMemoryStorageAdapter,
  cursor = 'c',
): Promise<void> {
  await storage.put('__sync_state__', {
    id: 'cursor',
    data: { value: cursor },
    revision: 1,
    createdAt: validTimestamp,
    updatedAt: validTimestamp,
    isDeleted: false,
  });
}
describe('Conflict resolution integration', () => {
  let storage: InMemoryStorageAdapter;
  let transport: StubSyncTransport;
  let queue: MutationQueue;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    transport = new StubSyncTransport();
    queue = await makeQueue(storage);
  });

  describe('CLIENT_WINS with field-level increment', () => {
    it('should re-apply increment on server data and re-enqueue', async () => {
      await seedEntity(storage, 'tasks', 'e1', { views: 100 }, 1);
      await enqueueMutation(queue, {
        id: 'mut-inc',
        operation: 'increment',
        field: 'views',
        value: 1,
      });
      await seedCursor(storage);

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.CLIENT_WINS,
      });
      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [{
          mutationId: 'mut-inc',
          entityId: 'e1',
          collectionName: 'tasks',
          clientRevision: 1,
          serverRevision: 5,
          serverEntity: {
            id: 'e1', data: { views: 150 }, revision: 5,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        }],
        newCursor: 'c-resolved',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(1);
      expect(result.conflictsResolved).toBe(1);

      // Verify resolved data: server's 150 + client's increment 1 = 151
      const entity = await storage.get<{ views: number }>('tasks', 'e1');
      expect(entity.data.views).toBe(151);
      expect(entity.revision).toBe(5);
    });
  });

  describe('OperationAwareStrategy via SyncEngine', () => {
    it('should merge increment and use LWW for set in same sync', async () => {
      // Entity 1: increment (commutative → merge)
      await seedEntity(storage, 'counters', 'counter-1', { value: 10 }, 1);
      await enqueueMutation(queue, {
        id: 'mut-inc',
        entityId: 'counter-1',
        collectionName: 'counters',
        operation: 'increment',
        field: 'value',
        value: 5,
      });

      // Entity 2: set (non-commutative → LWW)
      await seedEntity(storage, 'tasks', 'task-1', { title: 'Local' }, 1);
      await enqueueMutation(queue, {
        id: 'mut-set',
        entityId: 'task-1',
        collectionName: 'tasks',
        operation: 'set',
        field: null,
        value: { title: 'Local Title' },
        createdAt: tsNewer,
      });

      await seedCursor(storage);

      const resolver = new ConflictResolutionManager({
        defaultStrategy: new OperationAwareStrategy({
          commutativeStrategy: new FieldMergeStrategy(),
          nonCommutativeStrategy: new LastWriteWinsStrategy(),
        }),
      });

      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [
          {
            mutationId: 'mut-inc',
            entityId: 'counter-1',
            collectionName: 'counters',
            clientRevision: 1,
            serverRevision: 3,
            serverEntity: {
              id: 'counter-1', data: { value: 50 }, revision: 3,
              createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
            },
          },
          {
            mutationId: 'mut-set',
            entityId: 'task-1',
            collectionName: 'tasks',
            clientRevision: 1,
            serverRevision: 2,
            serverEntity: {
              id: 'task-1', data: { title: 'Server Title' }, revision: 2,
              createdAt: validTimestamp, updatedAt: tsOlder, isDeleted: false,
            },
          },
        ],
        newCursor: 'c-ops',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(2);
      expect(result.conflictsResolved).toBe(2);

      // Counter: 50 (server) + 5 (client increment) = 55
      const counter = await storage.get<{ value: number }>('counters', 'counter-1');
      expect(counter.data.value).toBe(55);

      // Task: client mutation is newer → client wins → uses local entity data
      const task = await storage.get<{ title: string }>('tasks', 'task-1');
      expect(task.data.title).toBe('Local');
    });
  });

  describe('FunctionStrategy via SyncEngine', () => {
    it('should use custom function strategy for resolution', async () => {
      await seedEntity(storage, 'tasks', 'e1', { priority: 'low' }, 1);
      await enqueueMutation(queue, {
        id: 'mut-fn',
        operation: 'set',
        field: null,
        value: { priority: 'high' },
      });
      await seedCursor(storage);

      const resolver = new ConflictResolutionManager({
        defaultStrategy: new FunctionStrategy((context) => {
          // Custom: always promote priority to 'critical' on conflict
          const serverData = context.serverEntity.data;
          if (typeof serverData === 'object' && serverData !== null) {
            return {
              resolved: true,
              outcome: RESOLUTION_OUTCOME.MERGED,
              resolvedData: { ...(serverData as Record<string, unknown>), priority: 'critical' },
            };
          }
          return {
            resolved: true,
            outcome: RESOLUTION_OUTCOME.SERVER_WINS,
            resolvedData: serverData,
          };
        }),
      });

      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [{
          mutationId: 'mut-fn',
          entityId: 'e1',
          collectionName: 'tasks',
          clientRevision: 1,
          serverRevision: 2,
          serverEntity: {
            id: 'e1', data: { priority: 'medium', status: 'open' }, revision: 2,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        }],
        newCursor: 'c-fn',
      });

      const result = await engine.sync();

      expect(result.conflictsResolved).toBe(1);

      const entity = await storage.get<{ priority: string; status: string }>('tasks', 'e1');
      expect(entity.data.priority).toBe('critical');
      expect(entity.data.status).toBe('open');
    });
  });

  describe('Per-collection strategies', () => {
    it('should use FIELD_MERGE for counters and LWW for tasks', async () => {
      // Counter entity
      await seedEntity(storage, 'counters', 'c1', { value: 10 }, 1);
      await enqueueMutation(queue, {
        id: 'mut-c1',
        entityId: 'c1',
        collectionName: 'counters',
        operation: 'increment',
        field: 'value',
        value: 5,
      });

      // Task entity
      await seedEntity(storage, 'tasks', 't1', { title: 'Local' }, 1);
      await enqueueMutation(queue, {
        id: 'mut-t1',
        entityId: 't1',
        collectionName: 'tasks',
        operation: 'set',
        field: null,
        value: { title: 'Local' },
        createdAt: tsNewer,
      });

      await seedCursor(storage);

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.LAST_WRITE_WINS,
        collectionStrategies: {
          counters: BUILT_IN_STRATEGY.FIELD_MERGE,
        },
      });

      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [
          {
            mutationId: 'mut-c1',
            entityId: 'c1',
            collectionName: 'counters',
            clientRevision: 1,
            serverRevision: 3,
            serverEntity: {
              id: 'c1', data: { value: 50 }, revision: 3,
              createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
            },
          },
          {
            mutationId: 'mut-t1',
            entityId: 't1',
            collectionName: 'tasks',
            clientRevision: 1,
            serverRevision: 2,
            serverEntity: {
              id: 't1', data: { title: 'Server' }, revision: 2,
              createdAt: validTimestamp, updatedAt: tsOlder, isDeleted: false,
            },
          },
        ],
        newCursor: 'c-colls',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(2);
      expect(result.conflictsResolved).toBe(2);

      // Counter: field merge → 50 + 5 = 55
      const counter = await storage.get<{ value: number }>('counters', 'c1');
      expect(counter.data.value).toBe(55);

      // Task: LWW → client newer → client wins
      const task = await storage.get<{ title: string }>('tasks', 't1');
      expect(task.data.title).toBe('Local');
    });
  });

  describe('onConflict callback for unresolved conflicts', () => {
    it('should fire callback with correct event data', async () => {
      await seedEntity(storage, 'transactions', 'tx1', { amount: 100 }, 1);
      await enqueueMutation(queue, {
        id: 'mut-tx',
        entityId: 'tx1',
        collectionName: 'transactions',
        operation: 'set',
        field: null,
        value: { amount: 200 },
      });
      await seedCursor(storage);

      const conflictEvents: {
        conflict: { mutationId: string; entityId: string };
        localMutation: { id: string; operation: string };
      }[] = [];

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.MANUAL,
      });

      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      engine.onConflict((event) => {
        conflictEvents.push({
          conflict: {
            mutationId: event.conflict.mutationId,
            entityId: event.conflict.entityId,
          },
          localMutation: {
            id: event.localMutation.id,
            operation: event.localMutation.operation,
          },
        });
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [{
          mutationId: 'mut-tx',
          entityId: 'tx1',
          collectionName: 'transactions',
          clientRevision: 1,
          serverRevision: 2,
          serverEntity: {
            id: 'tx1', data: { amount: 150 }, revision: 2,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        }],
        newCursor: 'c-manual',
      });

      const result = await engine.sync();

      expect(result.conflictsResolved).toBe(0);
      expect(conflictEvents).toHaveLength(1);
      expect(conflictEvents[0]?.conflict.mutationId).toBe('mut-tx');
      expect(conflictEvents[0]?.localMutation.operation).toBe('set');
    });
  });

  describe('Mixed ack + conflict + changes', () => {
    it('should handle acknowledged mutations, conflicts, and remote changes in one sync', async () => {
      // Entity A: will be acknowledged
      await seedEntity(storage, 'tasks', 'a1', { title: 'A' }, 1);
      await enqueueMutation(queue, {
        id: 'mut-ack',
        entityId: 'a1',
        collectionName: 'tasks',
        operation: 'patch',
        field: null,
        value: { done: true },
      });

      // Entity B: will conflict and auto-resolve
      await seedEntity(storage, 'tasks', 'b1', { count: 5 }, 1);
      await enqueueMutation(queue, {
        id: 'mut-conflict',
        entityId: 'b1',
        collectionName: 'tasks',
        operation: 'increment',
        field: 'count',
        value: 3,
      });

      await seedCursor(storage);

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.CLIENT_WINS,
      });

      const engine = new SyncEngine({
        clientId: 'test',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      transport.setNextSyncResponse({
        changes: [{
          serverSequence: 100,
          collectionName: 'tasks',
          entity: {
            id: 'c1', data: { title: 'Remote Change' }, revision: 1,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
          operation: 'set',
          field: null,
          value: { title: 'Remote Change' },
        }],
        acknowledgedMutationIds: ['mut-ack'],
        conflicts: [{
          mutationId: 'mut-conflict',
          entityId: 'b1',
          collectionName: 'tasks',
          clientRevision: 1,
          serverRevision: 4,
          serverEntity: {
            id: 'b1', data: { count: 20 }, revision: 4,
            createdAt: validTimestamp, updatedAt: validTimestamp, isDeleted: false,
          },
        }],
        newCursor: 'c-mixed',
      });

      const result = await engine.sync();

      expect(result.mutationsAcknowledged).toBe(1);
      expect(result.changesApplied).toBe(1);
      expect(result.conflictsDetected).toBe(1);
      expect(result.conflictsResolved).toBe(1);

      // Remote change applied
      const remoteEntity = await storage.get<{ title: string }>('tasks', 'c1');
      expect(remoteEntity.data.title).toBe('Remote Change');

      // Conflict resolved: server 20 + client increment 3 = 23
      const conflictedEntity = await storage.get<{ count: number }>('tasks', 'b1');
      expect(conflictedEntity.data.count).toBe(23);
    });
  });
});
