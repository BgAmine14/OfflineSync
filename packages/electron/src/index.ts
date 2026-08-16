/**
 * @offlinesync/electron
 *
 * Electron IPC bridge for OfflineSync.
 *
 * Bridges the main process SyncEngine to the renderer process
 * via Electron's IPC mechanism.
 *
 * Peer dependency: electron >= 22.0.0
 */

// Bridge
export {
  ElectronSyncBridge,
  IpcBridgeError,
  serializeForIpc,
  createIpcRequest,
  createIpcSuccessResponse,
  createIpcErrorResponse,
  deserializeSyncState,
  deserializeSyncCycleResult,
  generateRequestId,
  resetRequestIdCounter,
} from './ipc-bridge.js';

// Main process
export { createIPCHandler } from './ipc-handler.js';
export type { IpcHandlerRegistration } from './ipc-handler.js';

// Renderer process
export {
  createRendererSyncClient,
} from './renderer-client.js';
export type { RendererSyncClient, RendererSyncResult } from './renderer-client.js';

// Types
export { IPC_CHANNEL } from './types.js';
export type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  SerializedSyncState,
  SerializedSyncCycleResult,
  IpcMainLike,
  IpcRendererLike,
  IpcHandlerFunction,
  RegisteredHandler,
} from './types.js';
