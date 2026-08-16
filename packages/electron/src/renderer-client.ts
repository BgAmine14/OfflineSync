/**
 * Renderer process sync client.
 *
 * Provides a SyncEngine-like API in the Electron renderer
 * process by communicating with the main process via IPC.
 */

import type { SyncState } from '@offlinesync/core';
import type {
  IpcRendererLike,
  SerializedSyncState,
} from './types.js';
import { IPC_CHANNEL } from './types.js';
import { deserializeSyncState, deserializeSyncCycleResult, IpcBridgeError } from './ipc-bridge.js';

/**
 * Result of a sync cycle from the renderer's perspective.
 */
export interface RendererSyncResult {
  readonly changesApplied: number;
  readonly mutationsAcknowledged: number;
  readonly conflictsDetected: number;
  readonly conflictsResolved: number;
  readonly newCursor: string;
  readonly wasSnapshot: boolean;
}

/**
 * Client for the renderer process that communicates
 * with the main process sync engine via IPC.
 *
 * @example
 * ```typescript
 * const client = createRendererSyncClient(ipcRenderer);
 * const result = await client.sync();
 * ```
 */
export interface RendererSyncClient {
  /** Trigger a sync cycle via IPC. */
  sync(): Promise<RendererSyncResult>;
  /** Get the current sync state via IPC. */
  getSyncState(): Promise<SyncState>;
  /** Force a snapshot sync via IPC. */
  forceSnapshotSync(collections?: string[]): Promise<RendererSyncResult>;
  /** Subscribe to sync state changes pushed from main. */
  onSyncStateChange(callback: (state: SyncState) => void): () => void;
  /** Dispose the client and remove all listeners. */
  dispose(): void;
}

/**
 * Create a renderer-side sync client that communicates
 * with the main process via IPC.
 *
 * @param ipcRenderer - The Electron ipcRenderer-like object.
 * @returns A renderer sync client.
 */
export function createRendererSyncClient(
  ipcRenderer: IpcRendererLike,
): RendererSyncClient {
  const stateChangeListeners = new Set<(state: SyncState) => void>();
  const cleanups = new Array<() => void>();
  let disposed = false;

  // Listen for state changes pushed from main process
  const removeStateListener = ipcRenderer.on(
    IPC_CHANNEL.STATE_CHANGE,
    (...args: unknown[]) => {
      if (disposed) return;
      const data = args[0] as unknown;
      if (typeof data === 'object' && data !== null && 'syncState' in data) {
        const serialized = data as SerializedSyncState;
        try {
          const state = deserializeSyncState(serialized.syncState);
          for (const listener of stateChangeListeners) {
            listener(state);
          }
        } catch {
          // Invalid state from main — ignore
        }
      }
    },
  );
  cleanups.push(removeStateListener);

  async function sync(): Promise<RendererSyncResult> {
    assertNotDisposed();
    const response = await invokeAndValidate(
      ipcRenderer,
      IPC_CHANNEL.SYNC,
    );
    const result = deserializeSyncCycleResult(response);
    return result;
  }

  async function getSyncState(): Promise<SyncState> {
    assertNotDisposed();
    const response = await invokeAndValidate(
      ipcRenderer,
      IPC_CHANNEL.GET_STATE,
    );
    if (typeof response === 'object' && response !== null && 'syncState' in response) {
      const serialized = response as SerializedSyncState;
      return deserializeSyncState(serialized.syncState);
    }
    throw new IpcBridgeError(
      'Invalid sync state response from main process',
      'INVALID_RESPONSE',
    );
  }

  async function forceSnapshotSync(
    collections?: string[],
  ): Promise<RendererSyncResult> {
    assertNotDisposed();
    const response = await invokeAndValidate(
      ipcRenderer,
      IPC_CHANNEL.FORCE_SNAPSHOT,
      { collections },
    );
    const result = deserializeSyncCycleResult(response);
    return result;
  }

  function onSyncStateChange(
    callback: (state: SyncState) => void,
  ): () => void {
    stateChangeListeners.add(callback);
    return () => {
      stateChangeListeners.delete(callback);
    };
  }

  function dispose(): void {
    disposed = true;
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
    stateChangeListeners.clear();
  }

  function assertNotDisposed(): void {
    if (disposed) {
      throw new IpcBridgeError(
        'Renderer client has been disposed',
        'CLIENT_DISPOSED',
      );
    }
  }

  return {
    sync,
    getSyncState,
    forceSnapshotSync,
    onSyncStateChange,
    dispose,
  };
}

/**
 * Invoke an IPC channel and validate the response.
 *
 * @param ipcRenderer - The IPC renderer.
 * @param channel - The channel to invoke.
 * @param data - Optional data to send.
 * @returns The response data.
 * @throws {IpcBridgeError} if the invocation fails.
 */
async function invokeAndValidate(
  ipcRenderer: IpcRendererLike,
  channel: string,
  data?: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = await ipcRenderer.invoke(channel, data);
    if (
      typeof response === 'object' &&
      response !== null &&
      'success' in response
    ) {
      const ipcResponse = response as {
        success: boolean;
        data?: unknown;
        error?: string;
      };
      if (!ipcResponse.success) {
        throw new IpcBridgeError(
          ipcResponse.error ?? 'IPC request failed',
          'IPC_ERROR',
        );
      }
      return ipcResponse.data;
    }
    return response;
  } catch (error) {
    if (error instanceof IpcBridgeError) throw error;
    throw new IpcBridgeError(
      error instanceof Error ? error.message : String(error),
      'IPC_ERROR',
    );
  }
}
