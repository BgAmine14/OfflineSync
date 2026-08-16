/**
 * ElectronSyncBridge — central bridge for IPC communication.
 *
 * Manages handler registration and message routing between
 * the main and renderer processes.
 */

import type { IpcRequest, IpcResponse, IpcHandlerFunction, RegisteredHandler, IpcChannel, SerializedSyncCycleResult } from './types.js';
import type { SyncState } from '@offlinesync/core';

/**
 * Error thrown when the IPC bridge encounters an error.
 */
export class IpcBridgeError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'IpcBridgeError';
    this.code = code;
  }
}

/**
 * Central bridge for IPC communication between Electron processes.
 *
 * The bridge routes incoming messages to registered handlers
 * and serializes responses for IPC transfer.
 *
 * @example
 * ```typescript
 * const bridge = new ElectronSyncBridge();
 * bridge.registerHandler('offlinesync:sync', async (data) => {
 *   return await engine.sync();
 * });
 * const response = await bridge.handleMessage({
 *   id: 'req-1',
 *   channel: 'offlinesync:sync',
 * });
 * ```
 */
export class ElectronSyncBridge {
  private readonly handlers = new Map<string, IpcHandlerFunction>();
  private disposed = false;

  /**
   * Register a handler for an IPC channel.
   *
   * @param channel - The channel name to handle.
   * @param handler - The async handler function.
   * @throws {IpcBridgeError} if the bridge has been disposed.
   */
  registerHandler(channel: string, handler: IpcHandlerFunction): void {
    if (this.disposed) {
      throw new IpcBridgeError(
        'Cannot register handler on disposed bridge',
        'BRIDGE_DISPOSED',
      );
    }
    this.handlers.set(channel, handler);
  }

  /**
   * Remove a registered handler.
   *
   * @param channel - The channel name to unregister.
   */
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  /**
   * Check if a handler is registered for a channel.
   *
   * @param channel - The channel name.
   * @returns Whether a handler exists.
   */
  hasHandler(channel: string): boolean {
    return this.handlers.has(channel);
  }

  /**
   * Get all registered handlers.
   *
   * @returns Array of registered handler entries.
   */
  getRegisteredHandlers(): readonly RegisteredHandler[] {
    const result: RegisteredHandler[] = [];
    for (const [channel, handler] of this.handlers) {
      result.push({ channel, handler });
    }
    return result;
  }

  /**
   * Handle an incoming IPC request.
   *
   * Routes the request to the appropriate handler and returns
   * a serialized response.
   *
   * @param request - The incoming IPC request.
   * @returns The IPC response.
   */
  async handleMessage(request: IpcRequest): Promise<IpcResponse> {
    const handler = this.handlers.get(request.channel);

    if (handler === undefined) {
      return {
        id: request.id,
        success: false,
        error: `No handler registered for channel: ${request.channel}`,
      };
    }

    try {
      const data = await handler(request.data);
      return {
        id: request.id,
        success: true,
        data: serializeForIpc(data),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Dispose the bridge, removing all handlers.
   */
  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
  }

  /**
   * Whether the bridge has been disposed.
   */
  get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Serialize a value for IPC transfer.
 *
 * Handles special cases like undefined values and
 * ensures the result is JSON-safe.
 *
 * @param value - The value to serialize.
 * @returns The serialized value.
 */
export function serializeForIpc(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Create an IPC request with a unique ID.
 *
 * @param channel - The IPC channel.
 * @param data - Optional request data.
 * @returns An IPC request object.
 */
export function createIpcRequest(
  channel: string,
  data?: Record<string, unknown>,
): IpcRequest {
  return {
    id: generateRequestId(),
    channel: channel as IpcChannel,
    data,
  };
}

/**
 * Create an IPC success response.
 *
 * @param id - The request ID.
 * @param data - Optional response data.
 * @returns An IPC response object.
 */
export function createIpcSuccessResponse(
  id: string,
  data?: unknown,
): IpcResponse {
  return {
    id,
    success: true,
    data: serializeForIpc(data),
  };
}

/**
 * Create an IPC error response.
 *
 * @param id - The request ID.
 * @param errorMessage - The error message.
 * @returns An IPC response object.
 */
export function createIpcErrorResponse(
  id: string,
  errorMessage: string,
): IpcResponse {
  return {
    id,
    success: false,
    error: errorMessage,
  };
}

/**
 * Deserialize a sync state string into a valid SyncState.
 *
 * Validates that the string is a known sync state value.
 *
 * @param value - The sync state string from IPC.
 * @returns The validated sync state.
 * @throws {IpcBridgeError} if the value is not a valid sync state.
 */
export function deserializeSyncState(value: string): SyncState {
  const validStates: ReadonlySet<string> = new Set([
    'LOCAL_ONLY',
    'CONNECTING',
    'CONNECTED',
    'SYNCING',
    'SYNCED',
    'ERROR',
  ]);
  if (!validStates.has(value)) {
    throw new IpcBridgeError(
      `Invalid sync state: ${value}`,
      'INVALID_SYNC_STATE',
    );
  }
  return value as SyncState;
}

/**
 * Deserialize a sync cycle result from IPC.
 *
 * Validates the structure and returns a typed result.
 *
 * @param data - The raw data from IPC.
 * @returns The deserialized sync cycle result.
 * @throws {IpcBridgeError} if the data is malformed.
 */
export function deserializeSyncCycleResult(
  data: unknown,
): SerializedSyncCycleResult {
  if (data === null || typeof data !== 'object') {
    throw new IpcBridgeError(
      'Invalid sync cycle result: expected object',
      'INVALID_RESULT',
    );
  }
  const record = data as Record<string, unknown>;

  const requiredKeys = [
    'changesApplied',
    'mutationsAcknowledged',
    'conflictsDetected',
    'conflictsResolved',
    'newCursor',
    'wasSnapshot',
  ];

  for (const key of requiredKeys) {
    if (!(key in record)) {
      throw new IpcBridgeError(
        `Invalid sync cycle result: missing key '${key}'`,
        'INVALID_RESULT',
      );
    }
  }

  return data as SerializedSyncCycleResult;
}

let requestCounter = 0;

/**
 * Generate a unique request ID.
 *
 * @returns A unique string identifier.
 */
export function generateRequestId(): string {
  requestCounter += 1;
  return `offlinesync-req-${requestCounter}`;
}

/**
 * Reset the request ID counter. For testing only.
 */
export function resetRequestIdCounter(): void {
  requestCounter = 0;
}
