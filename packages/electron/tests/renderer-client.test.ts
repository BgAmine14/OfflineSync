/**
 * Tests for the renderer process sync client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRendererSyncClient } from '../src/renderer-client.js';
import type { IpcRendererLike } from '../src/types.js';
import { IPC_CHANNEL } from '../src/types.js';
import { IpcBridgeError } from '../src/ipc-bridge.js';

describe('createRendererSyncClient', () => {
  const stateChangeListeners = new Array<(...args: unknown[]) => void>();
  let invokeMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let ipcRenderer: IpcRendererLike;

  beforeEach(() => {
    stateChangeListeners.length = 0;
    invokeMock = vi.fn();
    onMock = vi.fn((channel, listener) => {
      stateChangeListeners.push(listener);
      return () => {
        const index = stateChangeListeners.indexOf(listener);
        if (index !== -1) {
          stateChangeListeners.splice(index, 1);
        }
      };
    });
    ipcRenderer = {
      invoke: invokeMock,
      on: onMock,
    };
  });

  // ----------------------------------------------------------------
  // sync
  // ----------------------------------------------------------------
  describe('sync', () => {
    it('should invoke sync channel and return result', async () => {
      const syncResult = {
        id: 'sync-1',
        success: true,
        data: {
          changesApplied: 3,
          mutationsAcknowledged: 1,
          conflictsDetected: 0,
          conflictsResolved: 0,
          newCursor: 'cursor-abc',
          wasSnapshot: false,
        },
      };
      invokeMock.mockResolvedValue(syncResult);

      const client = createRendererSyncClient(ipcRenderer);
      const result = await client.sync();

      expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNEL.SYNC, undefined);
      expect(result.changesApplied).toBe(3);
      expect(result.newCursor).toBe('cursor-abc');

      client.dispose();
    });

    it('should throw IpcBridgeError when sync fails on main', async () => {
      invokeMock.mockResolvedValue({
        id: 'sync-2',
        success: false,
        error: 'Transport error',
      });

      const client = createRendererSyncClient(ipcRenderer);

      await expect(client.sync()).rejects.toThrow(IpcBridgeError);
      await expect(client.sync()).rejects.toThrow('Transport error');

      client.dispose();
    });
  });

  // ----------------------------------------------------------------
  // getSyncState
  // ----------------------------------------------------------------
  describe('getSyncState', () => {
    it('should invoke getState channel and return sync state', async () => {
      invokeMock.mockResolvedValue({
        id: 'state-1',
        success: true,
        data: { syncState: 'SYNCED' },
      });

      const client = createRendererSyncClient(ipcRenderer);
      const state = await client.getSyncState();

      expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNEL.GET_STATE, undefined);
      expect(state).toBe('SYNCED');

      client.dispose();
    });

    it('should throw IpcBridgeError for invalid sync state from main', async () => {
      invokeMock.mockResolvedValue({
        id: 'state-2',
        success: true,
        data: { syncState: 'INVALID_STATE' },
      });

      const client = createRendererSyncClient(ipcRenderer);

      await expect(client.getSyncState()).rejects.toThrow(IpcBridgeError);

      client.dispose();
    });
  });

  // ----------------------------------------------------------------
  // forceSnapshotSync
  // ----------------------------------------------------------------
  describe('forceSnapshotSync', () => {
    it('should pass collections to forceSnapshot channel', async () => {
      invokeMock.mockResolvedValue({
        id: 'snap-1',
        success: true,
        data: {
          changesApplied: 50,
          mutationsAcknowledged: 0,
          conflictsDetected: 0,
          conflictsResolved: 0,
          newCursor: 'snap-cursor',
          wasSnapshot: true,
        },
      });

      const client = createRendererSyncClient(ipcRenderer);
      const result = await client.forceSnapshotSync(['users', 'tasks']);

      expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNEL.FORCE_SNAPSHOT, {
        collections: ['users', 'tasks'],
      });
      expect(result.wasSnapshot).toBe(true);
      expect(result.changesApplied).toBe(50);

      client.dispose();
    });
  });

  // ----------------------------------------------------------------
  // onSyncStateChange
  // ----------------------------------------------------------------
  describe('onSyncStateChange', () => {
    it('should call listener when state change event is received', () => {
      const client = createRendererSyncClient(ipcRenderer);
      const listener = vi.fn();

      const unsubscribe = client.onSyncStateChange(listener);

      // Simulate a state change event from main
      const stateListener = stateChangeListeners[0];
      if (stateListener !== undefined) {
        stateListener({ syncState: 'SYNCING' });
      }

      expect(listener).toHaveBeenCalledWith('SYNCING');

      // Unsubscribe and verify no more calls
      unsubscribe();
      if (stateListener !== undefined) {
        stateListener({ syncState: 'SYNCED' });
      }
      expect(listener).toHaveBeenCalledTimes(1);

      client.dispose();
    });

    it('should not call listeners for invalid state changes', () => {
      const client = createRendererSyncClient(ipcRenderer);
      const listener = vi.fn();

      client.onSyncStateChange(listener);

      const stateListener = stateChangeListeners[0];
      if (stateListener !== undefined) {
        stateListener({ syncState: 'INVALID' });
      }

      expect(listener).not.toHaveBeenCalled();

      client.dispose();
    });
  });

  // ----------------------------------------------------------------
  // dispose
  // ----------------------------------------------------------------
  describe('dispose', () => {
    it('should throw on operations after dispose', async () => {
      const client = createRendererSyncClient(ipcRenderer);
      client.dispose();

      await expect(client.sync()).rejects.toThrow(IpcBridgeError);
      await expect(client.getSyncState()).rejects.toThrow(IpcBridgeError);
    });

    it('should remove IPC listeners on dispose', () => {
      const client = createRendererSyncClient(ipcRenderer);
      expect(stateChangeListeners.length).toBe(1);

      client.dispose();

      expect(stateChangeListeners.length).toBe(0);
    });
  });
});
