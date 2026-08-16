import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { SyncEngine } from '../src/sync-engine.js';
import { StubSyncTransport } from '../src/sync-transport.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { MUTATION_STATUS } from '../src/types/index.js';
import {
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
} from '@offlinesync/conflict';
import type { Mutation } from '../src/types/index.js';

const validTimestamp = '2026-08-14T10:00:00Z';

async function makeQueue(storage: InMemoryStorageAdapter): Promise<MutationQueue> {
  return new MutationQueue({ storage });
}

async function enqueueTestMutation(
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

describe('SyncEngine auto-conflict resolution', () => {
  let storage: InMemoryStorageAdapter;
  let transport: StubSyncTransport;
  let queue: MutationQueue;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    transport = new StubSyncTransport();
    queue = await makeQueue(storage);
  });

  describe('with SERVER_WINS resolver', () => {
    it('should auto-resolve conflict and apply server data', async () => {
      await seedEntity(storage, 'tasks', 'entity-001', { title: 'Local' }, 1);
      await enqueueTestMutation(queue, { id: 'mut-auto' });

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.SERVER_WINS,
      });

      const engine = new SyncEngine({
        clientId: 'test-client',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      // Seed cursor for incremental sync
      await storage.put('__sync_state__', {
        id: 'cursor',
        data: { value: 'c' },
        revision: 1,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        isDeleted: false,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [
          {
            mutationId: 'mut-auto',
            entityId: 'entity-001',
            collectionName: 'tasks',
            clientRevision: 1,
            serverRevision: 5,
            serverEntity: {
              id: 'entity-001',
              data: { title: 'Server Won' },
              revision: 5,
              createdAt: validTimestamp,
              updatedAt: validTimestamp,
              isDeleted: false,
            },
          },
        ],
        newCursor: 'c-resolved',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(1);
      expect(result.conflictsResolved).toBe(1);

      // Verify server data was applied locally
      const entity = await storage.get<{ title: string }>('tasks', 'entity-001');
      expect(entity.data.title).toBe('Server Won');
      expect(entity.revision).toBe(5);
    });
  });

  describe('with MANUAL resolver', () => {
    it('should NOT auto-resolve and should mark conflict', async () => {
      await seedEntity(storage, 'tasks', 'entity-001', { title: 'Local' }, 1);
      await enqueueTestMutation(queue, { id: 'mut-manual' });

      const conflicts: { conflict: unknown; localMutation: unknown }[] = [];

      const resolver = new ConflictResolutionManager({
        defaultStrategy: BUILT_IN_STRATEGY.MANUAL,
      });

      const engine = new SyncEngine({
        clientId: 'test-client',
        storage,
        mutationQueue: queue,
        transport,
        conflictResolver: resolver,
      });

      engine.onConflict((event) => {
        conflicts.push(event);
      });

      await storage.put('__sync_state__', {
        id: 'cursor',
        data: { value: 'c' },
        revision: 1,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        isDeleted: false,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [
          {
            mutationId: 'mut-manual',
            entityId: 'entity-001',
            collectionName: 'tasks',
            clientRevision: 1,
            serverRevision: 2,
            serverEntity: {
              id: 'entity-001',
              data: { title: 'Server' },
              revision: 2,
              createdAt: validTimestamp,
              updatedAt: validTimestamp,
              isDeleted: false,
            },
          },
        ],
        newCursor: 'c-manual',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(1);
      expect(result.conflictsResolved).toBe(0);
      expect(conflicts).toHaveLength(1);
    });
  });

  describe('without resolver', () => {
    it('should fall back to original behavior (mark conflict)', async () => {
      await seedEntity(storage, 'tasks', 'entity-001', {}, 1);
      await enqueueTestMutation(queue, { id: 'mut-no-resolver' });

      const engine = new SyncEngine({
        clientId: 'test-client',
        storage,
        mutationQueue: queue,
        transport,
        // No conflictResolver
      });

      await storage.put('__sync_state__', {
        id: 'cursor',
        data: { value: 'c' },
        revision: 1,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        isDeleted: false,
      });

      transport.setNextSyncResponse({
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [
          {
            mutationId: 'mut-no-resolver',
            entityId: 'entity-001',
            collectionName: 'tasks',
            clientRevision: 1,
            serverRevision: 2,
            serverEntity: {
              id: 'entity-001', data: {}, revision: 2,
              createdAt: validTimestamp, updatedAt: validTimestamp,
              isDeleted: false,
            },
          },
        ],
        newCursor: 'c',
      });

      const result = await engine.sync();

      expect(result.conflictsDetected).toBe(1);
      expect(result.conflictsResolved).toBe(0);
    });
  });

  describe('MutationQueue.resolveConflict', () => {
    it('should transition CONFLICT mutation back to PENDING', async () => {
      await seedEntity(storage, 'tasks', 'e1', {}, 1);
      await enqueueTestMutation(queue, { id: 'mut-resolve' });

      // Manually mark as CONFLICT
      await queue.markConflict('mut-resolve', 'test conflict');

      // Resolve it
      await queue.resolveConflict('mut-resolve', {
        value: { resolved: true },
        operation: 'set',
      });

      // Should now be PENDING
      const pending = await queue.dequeuePending(100);
      const found = pending.find((m) => m.id === 'mut-resolve');
      expect(found).toBeDefined();
      if (found !== undefined) {
        expect(found.value).toEqual({ resolved: true });
      }
    });
  });
});
