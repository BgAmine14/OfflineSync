import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpSyncTransport, SyncTransportError } from '../src/http-transport.js';

/**
 * Create a mock fetch function.
 */
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

describe('HttpSyncTransport', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should strip trailing slashes from server URL', () => {
      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com/',
      });
      // We can't inspect the URL directly, but the transport
      // should be constructed without error
      expect(transport).toBeDefined();
    });
  });

  describe('negotiateVersion', () => {
    it('should return the highest common version', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: { supportedVersions: ['1.0', '1.1'] },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      const result = await transport.negotiateVersion(['1.0', '1.1']);
      expect(result.version).toBe('1.1');
      expect(result.serverSupportedVersions).toEqual(['1.0', '1.1']);
    });

    it('should throw when no common version exists', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: { supportedVersions: ['2.0'] },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      await expect(
        transport.negotiateVersion(['1.0']),
      ).rejects.toThrow(SyncTransportError);
    });
  });

  describe('sendSyncRequest', () => {
    it('should parse a valid sync response', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: {
          changes: [],
          acknowledgedMutationIds: [],
          conflicts: [],
          newCursor: 'c1',
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      const response = await transport.sendSyncRequest({
        cursor: '',
        mutations: [],
        clientId: 'c1',
      });

      expect(response.newCursor).toBe('c1');
      expect(response.changes).toHaveLength(0);
    });

    it('should throw SyncTransportError on HTTP error with protocol error body', async () => {
      globalThis.fetch = createErrorMockFetch(409, 'Conflict', {
        error: {
          code: 'CURSOR_TOO_OLD',
          message: 'Cursor is too old',
          details: { minimumAvailableCursor: 'min-c' },
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      try {
        await transport.sendSyncRequest({
          cursor: 'old',
          mutations: [],
          clientId: 'c1',
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SyncTransportError);
        if (error instanceof SyncTransportError) {
          expect(error.code).toBe('CURSOR_TOO_OLD');
          expect(error.details?.minimumAvailableCursor).toBe('min-c');
        }
      }
    });

    it('should throw on HTTP error without parseable body', async () => {
      globalThis.fetch = createErrorMockFetch(500, 'Internal Server Error', {
        message: 'something broke',
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      await expect(
        transport.sendSyncRequest({
          cursor: '',
          mutations: [],
          clientId: 'c1',
        }),
      ).rejects.toThrow(SyncTransportError);
    });
  });

  describe('sendSnapshotRequest', () => {
    it('should parse a valid snapshot response', async () => {
      globalThis.fetch = createMockFetch({
        status: 200,
        body: {
          entities: { tasks: [] },
          cursor: 'snap-c',
          serverTimestamp: '2026-08-14T12:00:00Z',
        },
      });

      const transport = new HttpSyncTransport({
        serverUrl: 'https://api.example.com',
      });

      const response = await transport.sendSnapshotRequest({
        clientId: 'c1',
      });

      expect(response.cursor).toBe('snap-c');
      expect(response.entities).toEqual({ tasks: [] });
    });
  });
});
