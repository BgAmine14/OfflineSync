/**
 * Tests for ElectronSyncBridge and serialization utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
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
} from '../src/ipc-bridge.js';
import type { IpcRequest, IpcChannel } from '../src/types.js';
import { IPC_CHANNEL } from '../src/types.js';

describe('ipc-bridge', () => {
  beforeEach(() => {
    resetRequestIdCounter();
  });

  // ----------------------------------------------------------------
  // ElectronSyncBridge
  // ----------------------------------------------------------------
  describe('ElectronSyncBridge', () => {
    it('should register and invoke a handler successfully', async () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:echo', async (data) => data);

      const request: IpcRequest = {
        id: 'req-1',
        channel: 'test:echo' as IpcChannel,
        data: { message: 'hello' },
      };

      const response = await bridge.handleMessage(request);

      expect(response.id).toBe('req-1');
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ message: 'hello' });

      bridge.dispose();
    });

    it('should return error response when handler is not registered', async () => {
      const bridge = new ElectronSyncBridge();

      const request: IpcRequest = {
        id: 'req-2',
        channel: IPC_CHANNEL.SYNC,
      };

      const response = await bridge.handleMessage(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('No handler registered');

      bridge.dispose();
    });

    it('should return error response when handler throws', async () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:fail', async () => {
        throw new Error('handler failed');
      });

      const request: IpcRequest = {
        id: 'req-3',
        channel: 'test:fail' as IpcChannel,
      };

      const response = await bridge.handleMessage(request);

      expect(response.success).toBe(false);
      expect(response.error).toBe('handler failed');

      bridge.dispose();
    });

    it('should handle non-Error throws with string fallback', async () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:non-error', async () => {
        throw 'string error';
      });

      const request: IpcRequest = {
        id: 'req-4',
        channel: 'test:non-error' as IpcChannel,
      };

      const response = await bridge.handleMessage(request);

      expect(response.success).toBe(false);
      expect(response.error).toBe('string error');

      bridge.dispose();
    });

    it('should report registered handlers via getRegisteredHandlers', () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:a', async () => null);
      bridge.registerHandler('test:b', async () => null);

      const handlers = bridge.getRegisteredHandlers();

      expect(handlers).toHaveLength(2);
      expect(handlers[0]?.channel).toBe('test:a');
      expect(handlers[1]?.channel).toBe('test:b');

      bridge.dispose();
    });

    it('should throw when registering handler on disposed bridge', () => {
      const bridge = new ElectronSyncBridge();
      bridge.dispose();

      expect(() => bridge.registerHandler('test:x', async () => null)).toThrow(
        IpcBridgeError,
      );
    });

    it('should remove handler via removeHandler', async () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:removable', async () => 'result');
      bridge.removeHandler('test:removable');

      expect(bridge.hasHandler('test:removable')).toBe(false);

      bridge.dispose();
    });

    it('should clear all handlers on dispose', () => {
      const bridge = new ElectronSyncBridge();
      bridge.registerHandler('test:a', async () => null);
      bridge.registerHandler('test:b', async () => null);

      bridge.dispose();

      expect(bridge.getRegisteredHandlers()).toHaveLength(0);
      expect(bridge.isDisposed).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // Serialization utilities
  // ----------------------------------------------------------------
  describe('serializeForIpc', () => {
    it('should return null for undefined', () => {
      expect(serializeForIpc(undefined)).toBeNull();
    });

    it('should pass through objects', () => {
      const data = { key: 'value' };
      expect(serializeForIpc(data)).toEqual(data);
    });

    it('should pass through primitive values', () => {
      expect(serializeForIpc('hello')).toBe('hello');
      expect(serializeForIpc(42)).toBe(42);
      expect(serializeForIpc(true)).toBe(true);
      expect(serializeForIpc(null)).toBe(null);
    });
  });

  describe('createIpcRequest', () => {
    it('should create a request with auto-generated ID', () => {
      const request = createIpcRequest(IPC_CHANNEL.SYNC);

      expect(request.id).toMatch(/^offlinesync-req-\d+$/);
      expect(request.channel).toBe(IPC_CHANNEL.SYNC);
      expect(request.data).toBeUndefined();
    });

    it('should create a request with data', () => {
      const request = createIpcRequest(IPC_CHANNEL.FORCE_SNAPSHOT, {
        collections: ['users'],
      });

      expect(request.data).toEqual({ collections: ['users'] });
    });
  });

  describe('createIpcSuccessResponse', () => {
    it('should create a success response with data', () => {
      const response = createIpcSuccessResponse('req-1', { count: 5 });

      expect(response.id).toBe('req-1');
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ count: 5 });
    });

    it('should serialize undefined data to null', () => {
      const response = createIpcSuccessResponse('req-2');

      expect(response.data).toBeNull();
    });
  });

  describe('createIpcErrorResponse', () => {
    it('should create an error response', () => {
      const response = createIpcErrorResponse('req-1', 'something failed');

      expect(response.id).toBe('req-1');
      expect(response.success).toBe(false);
      expect(response.error).toBe('something failed');
    });
  });

  describe('deserializeSyncState', () => {
    it('should deserialize a valid sync state', () => {
      expect(deserializeSyncState('SYNCED')).toBe('SYNCED');
      expect(deserializeSyncState('SYNCING')).toBe('SYNCING');
      expect(deserializeSyncState('LOCAL_ONLY')).toBe('LOCAL_ONLY');
      expect(deserializeSyncState('CONNECTING')).toBe('CONNECTING');
      expect(deserializeSyncState('CONNECTED')).toBe('CONNECTED');
      expect(deserializeSyncState('ERROR')).toBe('ERROR');
    });

    it('should throw for an invalid sync state', () => {
      expect(() => deserializeSyncState('INVALID')).toThrow(IpcBridgeError);
    });
  });

  describe('deserializeSyncCycleResult', () => {
    it('should deserialize a valid sync cycle result', () => {
      const data = {
        changesApplied: 10,
        mutationsAcknowledged: 5,
        conflictsDetected: 1,
        conflictsResolved: 0,
        newCursor: 'cursor-abc',
        wasSnapshot: false,
      };

      const result = deserializeSyncCycleResult(data);

      expect(result.changesApplied).toBe(10);
      expect(result.mutationsAcknowledged).toBe(5);
      expect(result.newCursor).toBe('cursor-abc');
    });

    it('should throw for null input', () => {
      expect(() => deserializeSyncCycleResult(null)).toThrow(IpcBridgeError);
    });

    it('should throw for missing required keys', () => {
      expect(() =>
        deserializeSyncCycleResult({ changesApplied: 1 }),
      ).toThrow(IpcBridgeError);
    });
  });

  describe('generateRequestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^offlinesync-req-\d+$/);
      expect(id2).toMatch(/^offlinesync-req-\d+$/);
    });
  });
});
