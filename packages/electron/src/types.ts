/**
 * Shared type definitions for @offlinesync/electron.
 *
 * These types define the IPC protocol between the main process
 * and the renderer process.
 */

/**
 * IPC channel names used for OfflineSync communication.
 */
export const IPC_CHANNEL = {
  /** Request a sync cycle from the main process. */
  SYNC: 'offlinesync:sync',
  /** Request the current sync state. */
  GET_STATE: 'offlinesync:getState',
  /** Request a force snapshot sync. */
  FORCE_SNAPSHOT: 'offlinesync:forceSnapshot',
  /** Push sync state changes from main to renderer. */
  STATE_CHANGE: 'offlinesync:stateChange',
  /** Trigger a manual sync from the renderer. */
  TRIGGER_SYNC: 'offlinesync:triggerSync',
} as const;

export type IpcChannel = (typeof IPC_CHANNEL)[keyof typeof IPC_CHANNEL];

/**
 * A request message sent from the renderer to the main process.
 */
export interface IpcRequest {
  /** Unique request ID for correlating responses. */
  readonly id: string;
  /** The IPC channel to handle the request. */
  readonly channel: IpcChannel;
  /** Optional request payload. */
  readonly data?: Record<string, unknown>;
}

/**
 * A response message sent from the main process to the renderer.
 */
export interface IpcResponse {
  /** The request ID this response corresponds to. */
  readonly id: string;
  /** Whether the request was successful. */
  readonly success: boolean;
  /** The response payload on success. */
  readonly data?: unknown;
  /** The error message on failure. */
  readonly error?: string;
}

/**
 * Serialized sync state for IPC transfer.
 *
 * Uses a plain object representation rather than
 * the enum-like string union for safe deserialization.
 */
export interface SerializedSyncState {
  /** The sync state string value. */
  readonly syncState: string;
}

/**
 * Serialized sync cycle result for IPC transfer.
 */
export interface SerializedSyncCycleResult {
  readonly changesApplied: number;
  readonly mutationsAcknowledged: number;
  readonly conflictsDetected: number;
  readonly conflictsResolved: number;
  readonly newCursor: string;
  readonly wasSnapshot: boolean;
}

/**
 * Abstract interface for Electron's ipcMain.
 *
 * Allows the IPC handler to work with any ipcMain-like object.
 */
export interface IpcMainLike {
  /** Register a handler for a channel. */
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown>,
  ): void;
}

/**
 * Abstract interface for Electron's ipcRenderer.
 *
 * Allows the renderer client to work with any ipcRenderer-like object.
 */
export interface IpcRendererLike {
  /** Send a message and wait for a response. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** Listen for messages on a channel. Returns cleanup function. */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

/**
 * Handler function registered with the IPC bridge.
 */
export type IpcHandlerFunction = (
  data: unknown,
) => Promise<unknown>;

/**
 * A registered handler entry.
 */
export interface RegisteredHandler {
  readonly channel: string;
  readonly handler: IpcHandlerFunction;
}
