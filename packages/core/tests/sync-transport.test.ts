import { describe, it, expect } from 'vitest';
import { StubSyncTransport } from '../src/sync-transport.js';

describe('StubSyncTransport', () => {
  it('should return default version info on negotiateVersion', async () => {
    const transport = new StubSyncTransport();
    const info = await transport.negotiateVersion(['1.0']);
    expect(info.version).toBe('1.0');
    expect(info.serverSupportedVersions).toEqual(['1.0']);
  });

  it('should return configured version info', async () => {
    const transport = new StubSyncTransport();
    transport.setNextVersionInfo({
      version: '1.1',
      serverSupportedVersions: ['1.0', '1.1'],
    });
    const info = await transport.negotiateVersion(['1.0', '1.1']);
    expect(info.version).toBe('1.1');
  });

  it('should return default sync response on sendSyncRequest', async () => {
    const transport = new StubSyncTransport();
    const response = await transport.sendSyncRequest({
      cursor: '',
      mutations: [],
      clientId: 'c1',
    });
    expect(response.newCursor).toBe('stub-cursor');
    expect(response.changes).toHaveLength(0);
    expect(response.acknowledgedMutationIds).toHaveLength(0);
    expect(response.conflicts).toHaveLength(0);
  });

  it('should return configured sync response', async () => {
    const transport = new StubSyncTransport();
    transport.setNextSyncResponse({
      changes: [],
      acknowledgedMutationIds: ['m1'],
      conflicts: [],
      newCursor: 'c-new',
    });
    const response = await transport.sendSyncRequest({
      cursor: 'c-old',
      mutations: [],
      clientId: 'c1',
    });
    expect(response.newCursor).toBe('c-new');
    expect(response.acknowledgedMutationIds).toEqual(['m1']);
  });

  it('should record the last sync request', async () => {
    const transport = new StubSyncTransport();
    await transport.sendSyncRequest({
      cursor: 'abc',
      mutations: [],
      clientId: 'c1',
    });
    const last = transport.getLastSyncRequest();
    expect(last?.cursor).toBe('abc');
    expect(last?.clientId).toBe('c1');
  });

  it('should return default snapshot response on sendSnapshotRequest', async () => {
    const transport = new StubSyncTransport();
    const response = await transport.sendSnapshotRequest({
      clientId: 'c1',
    });
    expect(response.cursor).toBe('stub-cursor');
    expect(response.entities).toEqual({});
  });

  it('should return configured snapshot response', async () => {
    const transport = new StubSyncTransport();
    transport.setNextSnapshotResponse({
      entities: { tasks: [] },
      cursor: 'snap-cursor',
      serverTimestamp: '2026-08-14T12:00:00Z',
    });
    const response = await transport.sendSnapshotRequest({
      clientId: 'c1',
    });
    expect(response.cursor).toBe('snap-cursor');
  });

  it('should record the last snapshot request', async () => {
    const transport = new StubSyncTransport();
    await transport.sendSnapshotRequest({
      clientId: 'c1',
      collections: ['tasks'],
    });
    const last = transport.getLastSnapshotRequest();
    expect(last?.clientId).toBe('c1');
    expect(last?.collections).toEqual(['tasks']);
  });

  it('should throw when failNext is set', async () => {
    const transport = new StubSyncTransport();
    transport.failNext(new Error('network error'));
    await expect(
      transport.sendSyncRequest({
        cursor: '',
        mutations: [],
        clientId: 'c1',
      }),
    ).rejects.toThrow('network error');
  });

  it('should clear the error after it is thrown', async () => {
    const transport = new StubSyncTransport();
    transport.failNext(new Error('first error'));
    await expect(
      transport.sendSyncRequest({
        cursor: '',
        mutations: [],
        clientId: 'c1',
      }),
    ).rejects.toThrow('first error');

    // Next call should succeed
    const response = await transport.sendSyncRequest({
      cursor: '',
      mutations: [],
      clientId: 'c1',
    });
    expect(response.newCursor).toBe('stub-cursor');
  });

  it('should reset all state', async () => {
    const transport = new StubSyncTransport();
    await transport.sendSyncRequest({
      cursor: 'abc',
      mutations: [],
      clientId: 'c1',
    });
    expect(transport.getLastSyncRequest()).not.toBeNull();

    transport.reset();
    expect(transport.getLastSyncRequest()).toBeNull();
    expect(transport.getLastSnapshotRequest()).toBeNull();
  });
});
