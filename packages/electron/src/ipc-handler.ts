/**
 * IPC handler factory for the main process.
 *
 * Creates Electron IPC handlers that bridge renderer requests
 * to the SyncEngine running in the main process.
 */

import type { SyncEngine } from '@offlinesync/core';
import type { IpcMainLike, IpcChannel } from './types.js';
import { IPC_CHANNEL } from './types.js';
import type { SerializedSyncCycleResult, SerializedSyncState } from './types.js';
import { ElectronSyncBridge } from './ipc-bridge.js';

/**
 * Result of creating IPC handlers.
 */
export interface IpcHandlerRegistration {
  /** The bridge that manages the handlers. */
  readonly bridge: ElectronSyncBridge;
  /** Remove all registered IPC handlers. */
  dispose(): void;
}

/**
 * Create IPC handlers for the main process.
 *
 * Registers handlers on ipcMain for common sync operations
 * such as triggering sync and getting sync state.
 *
 * @param engine - The SyncEngine to bridge.
 * @param ipcMain - The Electron ipcMain-like object.
 * @returns A registration with the bridge and dispose function.
 */
export function createIPCHandler(
  engine: SyncEngine,
  ipcMain: IpcMainLike,
): IpcHandlerRegistration {
  const bridge = new ElectronSyncBridge();

  bridge.registerHandler(IPC_CHANNEL.SYNC, async () => {
    const result = await engine.sync();
    const serialized: SerializedSyncCycleResult = {
      changesApplied: result.changesApplied,
      mutationsAcknowledged: result.mutationsAcknowledged,
      conflictsDetected: result.conflictsDetected,
      conflictsResolved: result.conflictsResolved,
      newCursor: result.newCursor,
      wasSnapshot: result.wasSnapshot,
    };
    return serialized;
  });

  bridge.registerHandler(IPC_CHANNEL.GET_STATE, async () => {
    const state: SerializedSyncState = {
      syncState: engine.syncState,
    };
    return state;
  });

  bridge.registerHandler(IPC_CHANNEL.FORCE_SNAPSHOT, async (data) => {
    const record = data as Record<string, unknown> | undefined;
    const collections = record?.collections as string[] | undefined;
    const result = await engine.forceSnapshotSync(collections);
    const serialized: SerializedSyncCycleResult = {
      changesApplied: result.changesApplied,
      mutationsAcknowledged: result.mutationsAcknowledged,
      conflictsDetected: result.conflictsDetected,
      conflictsResolved: result.conflictsResolved,
      newCursor: result.newCursor,
      wasSnapshot: result.wasSnapshot,
    };
    return serialized;
  });

  // Register all bridge handlers on ipcMain
  const registeredHandlers = bridge.getRegisteredHandlers();
  for (const entry of registeredHandlers) {
    ipcMain.handle(entry.channel, async (_event, requestData) => {
      return bridge.handleMessage({
        id: generateHandlerId(entry.channel),
        channel: entry.channel as IpcChannel,
        data: requestData as Record<string, unknown> | undefined,
      });
    });
  }

  return {
    bridge,
    dispose: () => {
      bridge.dispose();
    },
  };
}

let handlerCounter = 0;

/**
 * Generate a unique handler request ID.
 */
function generateHandlerId(channel: string): string {
  handlerCounter += 1;
  return `${channel}-handler-${handlerCounter}`;
}
