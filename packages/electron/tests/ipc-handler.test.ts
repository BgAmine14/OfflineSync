/**
 * Tests for IPC handler creation (main process side).
 */

import { describe, it, expect } from 'vitest';
import { createIPCHandler } from '../src/ipc-handler.js';
import type { IpcMainLike } from '../src/types.js';
import type { SyncEngine } from '@offlinesync/core';
import { IPC_CHANNEL } from '../src/types.js';
import type { IpcResponse } from '../src/types.js';

describe('createIPCHandler', () => {
  function createMockEngine(
    syncState = 'SYNCED',
  ): { engine: SyncEngine; syncFn: () => Promise<unknown> } {
    const syncFn = async (): Promise<{
      changesApplied: number;
      mutationsAcknowledged: number;
      conflictsDetected: number;
      conflictsResolved: number;
      newCursor: string;
      wasSnapshot: boolean;
    }> => {
      return {
        changesApplied: 10,
        mutationsAcknowledged: 5,
        conflictsDetected: 0,
        conflictsResolved: 0,
        newCursor: 'cursor-123',
        wasSnapshot: false,
      };
    };

    const engine = {
      get syncState() {
        return syncState;
      },
      sync: syncFn,
      forceSnapshotSync: async () => syncFn(),
      onConflict: () => { /* noop */ },
    } as SyncEngine;

    return { engine, syncFn };
  }

  function createMockIpcMain(): {
    ipcMain: IpcMainLike;
    getHandler(channel: string): ((event: unknown, ...args: unknown[]) => Promise<unknown>) | undefined;
  } {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    return {
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      getHandler(channel) {
        return handlers.get(channel);
      },
    };
  }

  it('should register handlers for sync, getState, and forceSnapshot', () => {
    const { engine } = createMockEngine();
    const { ipcMain, getHandler } = createMockIpcMain();

    createIPCHandler(engine, ipcMain);

    expect(getHandler(IPC_CHANNEL.SYNC)).toBeDefined();
    expect(getHandler(IPC_CHANNEL.GET_STATE)).toBeDefined();
    expect(getHandler(IPC_CHANNEL.FORCE_SNAPSHOT)).toBeDefined();
  });

  it('should return sync result when sync handler is invoked', async () => {
    const { engine } = createMockEngine();
    const { ipcMain, getHandler } = createMockIpcMain();

    createIPCHandler(engine, ipcMain);

    const handler = getHandler(IPC_CHANNEL.SYNC);
    if (handler === undefined) {
      throw new Error('Handler not registered');
    }

    const response = (await handler(null)) as IpcResponse;

    expect(response.success).toBe(true);
    const data = response.data as Record<string, unknown>;
    expect(data.changesApplied).toBe(10);
    expect(data.newCursor).toBe('cursor-123');
  });

  it('should return sync state when getState handler is invoked', async () => {
    const { engine } = createMockEngine('SYNCING');
    const { ipcMain, getHandler } = createMockIpcMain();

    createIPCHandler(engine, ipcMain);

    const handler = getHandler(IPC_CHANNEL.GET_STATE);
    if (handler === undefined) {
      throw new Error('Handler not registered');
    }

    const response = (await handler(null)) as IpcResponse;

    expect(response.success).toBe(true);
    const data = response.data as Record<string, unknown>;
    expect(data.syncState).toBe('SYNCING');
  });

  it('should pass collections to forceSnapshotSync handler', async () => {
    const { engine } = createMockEngine();
    const { ipcMain, getHandler } = createMockIpcMain();

    createIPCHandler(engine, ipcMain);

    const handler = getHandler(IPC_CHANNEL.FORCE_SNAPSHOT);
    if (handler === undefined) {
      throw new Error('Handler not registered');
    }

    const response = (await handler(null, { collections: ['users'] })) as IpcResponse;

    expect(response.success).toBe(true);
  });

  it('should dispose bridge when registration is disposed', () => {
    const { engine } = createMockEngine();
    const { ipcMain } = createMockIpcMain();

    const registration = createIPCHandler(engine, ipcMain);

    expect(registration.bridge.isDisposed).toBe(false);

    registration.dispose();

    expect(registration.bridge.isDisposed).toBe(true);
  });
});
