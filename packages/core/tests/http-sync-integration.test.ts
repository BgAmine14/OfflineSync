/**
 * Integration tests: HttpSyncTransport + SyncEngine end-to-end.
 *
 * These tests use a real HttpSyncTransport (with mocked fetch)
 * wired to a real SyncEngine with InMemoryStorageAdapter.
 * This verifies the full client → transport → server → transport → client pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../storage/tests/in-memory-storage-adapter.js';
import { SyncEngine } from '../src/sync-engine.js';
import { MutationQueue } from '../src/mutation-queue.js';
import { MUTATION_STATUS } from '../src/types/index.js';
import { HttpSyncTransport } from '@offlinesync/transport-http';
import { SYNC_ERROR_CODE } from '@offlinesync/protocol';
import type { Mutation } from '../src/types/index.js';

const validTimestamp = '2026-08-14T10:00:00Z';

// ----------------------------------------------------------------
// Mock fetch helpers
// ----------------------------------------------------------------

function createMockFetch(response: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}) {
  return async (_url: string, _options?: unknown): Promise<Response> => {
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: 'OK',
      headers: new Headers(response.headers),
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  };
}

function createErrorMockFetch(
  status: number,
  statusText: string,
  body: unknown,
) {
  return async (_url: string, _options?: unknown): Promise<Response> => {
    return {
      ok: false,
      status,
      statusText,
      headers: new Headers(),
      json: async () => body,
    } as Response;
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

async function enqueueMutation(
  queue: MutationQueue,
  storage: InMemoryStorageAdapter,
): Promise<void> {
  await storage.put('tasks', {
    id: 'entity-001',
    data: { title: 'Test' },
    revision: 1,
    createdAt: validTimestamp,
    updatedAt: validTimestamp,
    isDeleted: false,
  });

  const mutation: Mutation = {
    id: 'mut-001',
    entityId: 'entity-001',
    collectionName: 'tasks',
    operation: 'set',
    field: null,
    value: { title: 'Updated' },
    sequence: 1,
    status: MUTATION_STATUS.PENDING,
    createdAt: validTimestamp,
    retries: 0,
    lastError: null,
  };
  await queue.enqueue(mutation);
}

describe('HttpSyncTransport + SyncEngine integration', () => {
  let originalFetch: typeof globalThis.fetch;
  let storage: InMemoryStorageAdapter;
  let queue: MutationQueue;
  let engine: SyncEngine;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    storage = new InMemoryStorageAdapter();
    queue = new MutationQueue({ storage });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ============================================================
  // Full pipeline: initial snapshot sync
  // ============================================================

  describe('initial snapshot sync via HTTP', () => {
    it('should perform full snapshot sync through HTTP transport', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: {
          entities: {
            tasks: [
              {
                id: 't1',
                data: { title: 'Server Task' },
                revision: 1,
                createdAt: validTimestamp,
                updatedAt: validTimestamp,
                isDeleted: false,
              },
              {
                id: 't2',
                data: { title: 'Another Task' },
                revision: 1,
                createdAt: validTimestamp,
                updatedAt: validTimestamp,
                isDeleted: false,
              },
            ],
          },
          cursor: 'http-snap-cursor',
          serverTimestamp: validTimestamp,
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      engine = new SyncEngine({
        clientId: 'http-client',
        storage,
        mutationQueue: queue,
        transport,
      });

      const result = await engine.sync();

      expect(result.wasSnapshot).toBe(true);
      expect(result.changesApplied).toBe(2);
      expect(result.newCursor).toBe('http-snap-cursor');

      // Verify entities are in storage
      const t1 = await storage.get<{ title: string }>('tasks', 't1');
      expect(t1.data.title).toBe('Server Task');

      const t2 = await storage.get<{ title: string }>('tasks', 't2');
      expect(t2.data.title).toBe('Another Task');
    });
  });

  // ============================================================
  // Full pipeline: incremental sync via HTTP
  // ============================================================

  describe('incremental sync via HTTP', () => {
    beforeEach(async () => {
      // Seed a cursor so incremental sync is used
      await storage.put('__sync_state__', {
        id: 'cursor',
        data: { value: 'existing-cursor' },
        revision: 1,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        isDeleted: false,
      });
    });

    it('should send mutations and apply remote changes via HTTP', async () => {
      await enqueueMutation(queue, storage);

      globalThis.fetch = createMockFetch({
        status: 200,
        body: {
          changes: [
            {
              serverSequence: 200,
              collectionName: 'tasks',
              entity: {
                id: 'remote-1',
                data: { title: 'Remote Change' },
                revision: 1,
                createdAt: validTimestamp,
                updatedAt: validTimestamp,
                isDeleted: false,
              },
              operation: 'set',
              field: null,
              value: { title: 'Remote Change' },
            },
          ],
          acknowledgedMutationIds: ['mut-001'],
          conflicts: [],
          newCursor: 'http-inc-cursor',
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      engine = new SyncEngine({
        clientId: 'http-client',
        storage,
        mutationQueue: queue,
        transport,
      });

      const result = await engine.sync();

      expect(result.wasSnapshot).toBe(false);
      expect(result.mutationsAcknowledged).toBe(1);
      expect(result.changesApplied).toBe(1);
      expect(result.newCursor).toBe('http-inc-cursor');

      // Verify remote change applied
      const remote = await storage.get<{ title: string }>('tasks', 'remote-1');
      expect(remote.data.title).toBe('Remote Change');
    });

    it('should recover from CURSOR_TOO_OLD via HTTP', async () => {
      let callCount = 0;
      globalThis.fetch = async (url: string, options?: unknown) => {
        callCount++;
        if (callCount === 1) {
          // First call: incremental — returns CURSOR_TOO_OLD
          return createErrorMockFetch(409, 'Conflict', {
            error: {
              code: SYNC_ERROR_CODE.CURSOR_TOO_OLD,
              message: 'Cursor is too old',
              details: { minimumAvailableCursor: 'min-c' },
            },
          })(url, options);
        }
        // Second call: snapshot sync
        return createMockFetch({
          status: 200,
          body: {
            entities: {
              tasks: [
                {
                  id: 'recovered-1',
                  data: { title: 'Recovered via HTTP' },
                  revision: 1,
                  createdAt: validTimestamp,
                  updatedAt: validTimestamp,
                  isDeleted: false,
                },
              ],
            },
            cursor: 'recovery-cursor',
            serverTimestamp: validTimestamp,
          },
        })(url, options);
      };

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      engine = new SyncEngine({
        clientId: 'http-client',
        storage,
        mutationQueue: queue,
        transport,
      });

      const result = await engine.sync();

      expect(result.wasSnapshot).toBe(true);
      expect(result.changesApplied).toBe(1);
      expect(result.newCursor).toBe('recovery-cursor');
      expect(callCount).toBe(2);

      // Verify recovered entity
      const recovered = await storage.get<{ title: string }>('tasks', 'recovered-1');
      expect(recovered.data.title).toBe('Recovered via HTTP');
    });
  });

  // ============================================================
  // Version negotiation via HTTP
  // ============================================================

  describe('version negotiation via HTTP', () => {
    it('should negotiate version with server', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: {
          supportedVersions: ['1.0', '1.1', '2.0'],
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      const info = await transport.negotiateVersion(['1.0', '1.1']);

      expect(info.version).toBe('1.1');
      expect(info.serverSupportedVersions).toEqual(['1.0', '1.1', '2.0']);
    });
  });
});
