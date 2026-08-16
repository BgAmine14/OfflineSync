import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebSocketSyncTransport,
  WS_CONNECTION_STATE,
  type MinimalWebSocket,
  type WebSocketFactory,
} from '../src/ws-transport.js';
import { WS_MSG_TYPE } from '../src/ws-types.js';
import { SyncTransportError } from '@offlinesync/transport-http';
import { SYNC_ERROR_CODE } from '@offlinesync/protocol';
import { isWsServerMessage } from '../src/ws-types.js';

// -------------------------------------------------------------------
// Polyfill browser globals not available in Node.js
// -------------------------------------------------------------------

class PolyfilledCloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1000;
    this.reason = init?.reason ?? '';
    this.wasClean = init?.wasClean ?? true;
  }
}

if (typeof globalThis.CloseEvent === 'undefined') {
  (globalThis as Record<string, unknown>).CloseEvent = PolyfilledCloseEvent;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

interface MockWs {
  ws: MinimalWebSocket;
  simulateOpen(): void;
  simulateMessage(data: unknown): void;
  simulateClose(event?: CloseEvent): void;
  simulateError(event?: Event): void;
  lastSentData(): string | undefined;
  allSentData(): string[];
  resetSentData(): void;
}

function requireLastSent(mock: MockWs): string {
  const data = mock.lastSentData();
  if (data === undefined) {
    throw new Error('Expected WebSocket to have sent data but none was sent');
  }
  return data;
}

function requireMockAt(mocks: MockWs[], index: number): MockWs {
  const m = mocks[index];
  if (m === undefined) {
    throw new Error(`Expected mock at index ${index} but none exists`);
  }
  return m;
}

/** Create a valid Change object that passes isChange() validation. */
function makeValidChange(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    serverSequence: 1,
    collectionName: 'tasks',
    entity: {
      id: 'entity-1',
      data: { title: 'Test' },
      revision: 1,
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
      isDeleted: false,
    },
    operation: 'set',
    field: 'title',
    value: 'Test',
    ...overrides,
  };
}

/**
 * Assert a rejected promise is a SyncTransportError with given code.
 */
async function expectRejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    expect.unreachable('Should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SyncTransportError);
    if (error instanceof SyncTransportError) {
      expect(error.code).toBe(code);
    }
  }
}

// -------------------------------------------------------------------
// Mock WebSocket
// -------------------------------------------------------------------

function createMockWs(options?: {
  /** If true, do NOT auto-open. */
  manualOpen?: boolean;
}): MockWs {
  const sentData: string[] = [];
  const listeners = new Map<string, Set<EventListener>>();

  const ws = {
    readyState: 0,
    send(data: string): void {
      sentData.push(data);
    },
    close(_code?: number, _reason?: string): void {
      ws.readyState = 3;
      const closeEvent = new CloseEvent('close', { code: 1000, reason: 'closed' });
      const cbs = listeners.get('close');
      if (cbs) {
        for (const cb of cbs) {
          cb(closeEvent);
        }
      }
    },
    addEventListener(
      type: 'message' | 'open' | 'close' | 'error',
      listener: EventListener,
    ): void {
      let set = listeners.get(type);
      if (set === undefined) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(
      type: 'message' | 'open' | 'close' | 'error',
      listener: EventListener,
    ): void {
      const set = listeners.get(type);
      if (set !== undefined) {
        set.delete(listener);
      }
    },
  } satisfies MinimalWebSocket;

  function simulateOpen(): void {
    ws.readyState = 1;
    const cbs = listeners.get('open');
    if (cbs) {
      const event = new Event('open');
      for (const cb of cbs) {
        cb(event);
      }
    }
  }

  function simulateMessage(data: unknown): void {
    const cbs = listeners.get('message');
    if (cbs) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data),
      });
      for (const cb of cbs) {
        cb(event);
      }
    }
  }

  function simulateClose(event?: CloseEvent): void {
    ws.readyState = 3;
    const closeEvent = event ?? new CloseEvent('close', { code: 1006, reason: 'abnormal' });
    const cbs = listeners.get('close');
    if (cbs) {
      for (const cb of cbs) {
        cb(closeEvent);
      }
    }
  }

  function simulateError(event?: Event): void {
    const errorEvent = event ?? new Event('error');
    const cbs = listeners.get('error');
    if (cbs) {
      for (const cb of cbs) {
        cb(errorEvent);
      }
    }
  }

  function lastSentData(): string | undefined {
    return sentData[sentData.length - 1];
  }

  function allSentData(): string[] {
    return [...sentData];
  }

  function resetSentData(): void {
    sentData.length = 0;
  }

  if (!options?.manualOpen) {
    queueMicrotask(simulateOpen);
  }

  return {
    ws,
    simulateOpen,
    simulateMessage,
    simulateClose,
    simulateError,
    lastSentData,
    allSentData,
    resetSentData,
  };
}

// -------------------------------------------------------------------
// Transport factory
// -------------------------------------------------------------------

interface TestTransportResult {
  transport: WebSocketSyncTransport;
  latestMock: () => MockWs;
  mockAt: (index: number) => MockWs;
  allMocks: MockWs[];
}

function createTestTransport(options?: {
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMultiplier?: number;
  reconnectMaxDelayMs?: number;
  manualOpen?: boolean;
}): TestTransportResult {
  const mocks: MockWs[] = [];

  const factory: WebSocketFactory = (_url) => {
    const mock = createMockWs({ manualOpen: options?.manualOpen });
    mocks.push(mock);
    return mock.ws;
  };

  const transport = new WebSocketSyncTransport({
    url: 'wss://test.example.com/sync',
    wsFactory: factory,
    heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 0,
    pongTimeoutMs: options?.pongTimeoutMs ?? 10_000,
    maxReconnectAttempts: options?.maxReconnectAttempts ?? 0,
    reconnectBaseDelayMs: options?.reconnectBaseDelayMs ?? 100,
    reconnectMultiplier: options?.reconnectMultiplier ?? 2,
    reconnectMaxDelayMs: options?.reconnectMaxDelayMs ?? 500,
  });

  function latestMock(): MockWs {
    return mocks[mocks.length - 1] ?? (expect.unreachable('No mock created') as never);
  }

  function mockAt(index: number): MockWs {
    return requireMockAt(mocks, index);
  }

  return { transport, latestMock, mockAt, allMocks: mocks };
}

async function connectTransport(
  transport: WebSocketSyncTransport,
): Promise<void> {
  transport.connect();
  await vi.waitFor(() => {
    expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
  });
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('WebSocketSyncTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Connection lifecycle
  // ----------------------------------------------------------------

  describe('connection lifecycle', () => {
    it('should start in DISCONNECTED state', () => {
      const { transport } = createTestTransport();
      expect(transport.state).toBe(WS_CONNECTION_STATE.DISCONNECTED);
      transport.dispose();
    });

    it('should transition to CONNECTING then CONNECTED', async () => {
      const { transport } = createTestTransport();
      transport.connect();
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      await vi.waitFor(() => {
        expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      });

      transport.dispose();
    });

    it('should be a no-op when connect() is called while CONNECTED', async () => {
      const { transport } = createTestTransport();
      await connectTransport(transport);
      const stateBefore = transport.state;
      transport.connect();
      expect(transport.state).toBe(stateBefore);
      transport.dispose();
    });

    it('should transition to DISCONNECTED on disconnect()', async () => {
      const { transport } = createTestTransport();
      await connectTransport(transport);
      transport.disconnect();
      expect(transport.state).toBe(WS_CONNECTION_STATE.DISCONNECTED);
      transport.dispose();
    });

    it('should reject connect() after dispose()', () => {
      const { transport } = createTestTransport();
      transport.dispose();
      expect(() => transport.connect()).toThrow(SyncTransportError);
    });

    it('should fire onConnectionStateChange callbacks', async () => {
      const { transport } = createTestTransport();
      const states: string[] = [];
      transport.onConnectionStateChange((s) => states.push(s));

      transport.connect();
      await vi.waitFor(() => {
        expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      });

      transport.disconnect();
      transport.dispose();

      expect(states).toContain(WS_CONNECTION_STATE.CONNECTING);
      expect(states).toContain(WS_CONNECTION_STATE.CONNECTED);
      expect(states).toContain(WS_CONNECTION_STATE.DISCONNECTED);
      expect(states).toContain(WS_CONNECTION_STATE.DISPOSED);
    });

    it('should allow unsubscribing from state changes', async () => {
      const { transport } = createTestTransport();
      const states: string[] = [];
      const unsub = transport.onConnectionStateChange((s) => states.push(s));
      unsub();

      transport.connect();
      await vi.waitFor(() => {
        expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      });

      expect(states).toHaveLength(0);
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Version negotiation
  // ----------------------------------------------------------------

  describe('negotiateVersion', () => {
    it('should negotiate version successfully', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const negotiatePromise = transport.negotiateVersion(['1.0', '1.1']);
      await vi.advanceTimersByTimeAsync(0);

      const sent = JSON.parse(requireLastSent(latestMock()));
      expect(sent.type).toBe(WS_MSG_TYPE.VERSION_NEGOTIATION);

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.VERSION_RESPONSE,
        id: sent.id,
        version: '1.1',
        serverSupportedVersions: ['1.0', '1.1'],
      });

      const result = await negotiatePromise;
      expect(result.version).toBe('1.1');
      expect(result.serverSupportedVersions).toEqual(['1.0', '1.1']);
      transport.dispose();
    });

    it('should throw on invalid version response', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const negotiatePromise = transport.negotiateVersion(['1.0']);
      await vi.advanceTimersByTimeAsync(0);

      const sent = JSON.parse(requireLastSent(latestMock()));
      latestMock().simulateMessage({
        type: WS_MSG_TYPE.VERSION_RESPONSE,
        id: sent.id,
        version: 123,
        serverSupportedVersions: ['1.0'],
      });

      await expectRejectsWithCode(negotiatePromise, SYNC_ERROR_CODE.INVALID_REQUEST);
      transport.dispose();
    });

    it('should throw NOT_CONNECTED when not connected', async () => {
      const { transport } = createTestTransport({ manualOpen: true });
      transport.connect();
      await expectRejectsWithCode(
        transport.negotiateVersion(['1.0']),
        'NOT_CONNECTED',
      );
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Sync request
  // ----------------------------------------------------------------

  describe('sendSyncRequest', () => {
    it('should send a sync request and receive a response', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const syncPromise = transport.sendSyncRequest({
        cursor: 'c1',
        mutations: [],
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      const sent = JSON.parse(requireLastSent(latestMock()));
      expect(sent.type).toBe(WS_MSG_TYPE.SYNC_REQUEST);
      expect(sent.request.cursor).toBe('c1');
      expect(sent.id).toBeDefined();

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SYNC_RESPONSE,
        id: sent.id,
        response: {
          changes: [],
          acknowledgedMutationIds: [],
          conflicts: [],
          newCursor: 'c2',
        },
      });

      const result = await syncPromise;
      expect(result.newCursor).toBe('c2');
      transport.dispose();
    });

    it('should throw on invalid sync response', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const syncPromise = transport.sendSyncRequest({
        cursor: 'c1',
        mutations: [],
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      const sent = JSON.parse(requireLastSent(latestMock()));

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SYNC_RESPONSE,
        id: sent.id,
        response: { invalid: 'data' },
      });

      await expectRejectsWithCode(syncPromise, SYNC_ERROR_CODE.INVALID_REQUEST);
      transport.dispose();
    });

    it('should handle server error response correlated to request', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const syncPromise = transport.sendSyncRequest({
        cursor: 'old',
        mutations: [],
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      const sent = JSON.parse(requireLastSent(latestMock()));

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.ERROR,
        id: sent.id,
        code: 'CURSOR_TOO_OLD',
        message: 'Cursor is too old',
        details: { minCursor: 'min-c' },
      });

      await expectRejectsWithCode(syncPromise, 'CURSOR_TOO_OLD');
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Snapshot request
  // ----------------------------------------------------------------

  describe('sendSnapshotRequest', () => {
    it('should send a snapshot request and receive a response', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const snapPromise = transport.sendSnapshotRequest({
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      const sent = JSON.parse(requireLastSent(latestMock()));
      expect(sent.type).toBe(WS_MSG_TYPE.SNAPSHOT_REQUEST);
      expect(sent.request.clientId).toBe('client-1');

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SNAPSHOT_RESPONSE,
        id: sent.id,
        response: {
          entities: { tasks: [] },
          cursor: 'snap-c',
          serverTimestamp: '2026-08-15T00:00:00Z',
        },
      });

      const result = await snapPromise;
      expect(result.cursor).toBe('snap-c');
      expect(result.entities).toEqual({ tasks: [] });
      transport.dispose();
    });

    it('should throw on invalid snapshot response', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const snapPromise = transport.sendSnapshotRequest({
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      const sent = JSON.parse(requireLastSent(latestMock()));

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SNAPSHOT_RESPONSE,
        id: sent.id,
        response: { bad: true },
      });

      await expectRejectsWithCode(snapPromise, SYNC_ERROR_CODE.INVALID_REQUEST);
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Push changes
  // ----------------------------------------------------------------

  describe('push changes', () => {
    it('should invoke onPush callback when server pushes changes', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const pushedChanges: unknown[] = [];
      let pushedCursor = '';
      transport.onPush((changes, cursor) => {
        pushedChanges.push(...changes);
        pushedCursor = cursor;
      });

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.PUSH_CHANGES,
        changes: [makeValidChange({ serverSequence: 5 })],
        cursor: 'push-c1',
      });

      expect(pushedChanges).toHaveLength(1);
      expect(pushedCursor).toBe('push-c1');
      transport.dispose();
    });

    it('should invoke multiple push listeners', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const counts = [0, 0];
      transport.onPush(() => { counts[0]++; });
      transport.onPush(() => { counts[1]++; });

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.PUSH_CHANGES,
        changes: [makeValidChange()],
        cursor: 'c1',
      });

      expect(counts[0]).toBe(1);
      expect(counts[1]).toBe(1);
      transport.dispose();
    });

    it('should allow unsubscribing from push', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      let count = 0;
      const unsub = transport.onPush(() => { count++; });
      unsub();

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.PUSH_CHANGES,
        changes: [makeValidChange()],
        cursor: 'c1',
      });

      expect(count).toBe(0);
      transport.dispose();
    });

    it('should ignore push messages with no valid changes', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      let called = false;
      transport.onPush(() => { called = true; });

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.PUSH_CHANGES,
        changes: [{ notARealChange: true }],
        cursor: 'c1',
      });

      expect(called).toBe(false);
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Heartbeat
  // ----------------------------------------------------------------

  describe('heartbeat', () => {
    it('should send PING at the configured interval', async () => {
      const { transport, latestMock } = createTestTransport({
        heartbeatIntervalMs: 100,
      });
      await connectTransport(transport);

      latestMock().resetSentData();
      await vi.advanceTimersByTimeAsync(100);

      const lastData = latestMock().lastSentData();
      expect(lastData).toBeDefined();
      const parsed = JSON.parse(lastData ?? '');
      expect(parsed.type).toBe(WS_MSG_TYPE.PING);
      expect(typeof parsed.timestamp).toBe('number');

      transport.dispose();
    });

    it('should not send PING when heartbeatIntervalMs is 0', async () => {
      const { transport, latestMock } = createTestTransport({
        heartbeatIntervalMs: 0,
      });
      await connectTransport(transport);

      latestMock().resetSentData();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(latestMock().allSentData()).toHaveLength(0);
      transport.dispose();
    });

    it('should handle PONG from server', async () => {
      const { transport, latestMock } = createTestTransport({
        heartbeatIntervalMs: 100,
      });
      await connectTransport(transport);

      latestMock().resetSentData();
      await vi.advanceTimersByTimeAsync(101);
      const pingData = JSON.parse(requireLastSent(latestMock()));
      expect(pingData.type).toBe(WS_MSG_TYPE.PING);

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.PONG,
        timestamp: pingData.timestamp,
      });

      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      transport.dispose();
    });

    it('should close connection when PONG is not received', async () => {
      const { transport } = createTestTransport({
        heartbeatIntervalMs: 100,
        pongTimeoutMs: 50,
        maxReconnectAttempts: 3,
      });
      await connectTransport(transport);

      await vi.advanceTimersByTimeAsync(101);
      await vi.advanceTimersByTimeAsync(50);

      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);
      transport.dispose();
    });

    it('should stop heartbeat on disconnect', async () => {
      const { transport, latestMock } = createTestTransport({
        heartbeatIntervalMs: 100,
      });
      await connectTransport(transport);

      transport.disconnect();
      latestMock().resetSentData();

      await vi.advanceTimersByTimeAsync(500);
      expect(latestMock().allSentData()).toHaveLength(0);
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Reconnection
  // ----------------------------------------------------------------

  describe('reconnection', () => {
    it('should reconnect on unintentional close', async () => {
      const { transport, latestMock } = createTestTransport({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 100,
      });
      await connectTransport(transport);

      latestMock().simulateClose(new CloseEvent('close', { code: 1006, reason: 'abnormal' }));
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);

      await vi.advanceTimersByTimeAsync(101);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      transport.dispose();
    });

    it('should use exponential backoff when reconnections fail', async () => {
      const { transport, mockAt } = createTestTransport({
        manualOpen: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelayMs: 100,
        reconnectMultiplier: 2,
      });

      transport.connect();
      mockAt(0).simulateOpen();
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);

      // Close unexpectedly — reconnect attempt 1 (delay = 100ms)
      mockAt(0).simulateClose(new CloseEvent('close', { code: 1006 }));
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);

      await vi.advanceTimersByTimeAsync(100);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      // Simulate the new connection failing
      mockAt(1).simulateClose(new CloseEvent('close', { code: 1006 }));
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);

      // Reconnect attempt 2 (delay = 200ms)
      await vi.advanceTimersByTimeAsync(199);
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);
      await vi.advanceTimersByTimeAsync(2);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      // Simulate failure again
      mockAt(2).simulateClose(new CloseEvent('close', { code: 1006 }));
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);

      // Reconnect attempt 3 (delay = 400ms)
      await vi.advanceTimersByTimeAsync(399);
      expect(transport.state).toBe(WS_CONNECTION_STATE.RECONNECTING);
      await vi.advanceTimersByTimeAsync(2);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      transport.dispose();
    });

    it('should cap reconnect delay at maxReconnectDelayMs', async () => {
      const { transport, mockAt } = createTestTransport({
        manualOpen: true,
        maxReconnectAttempts: 10,
        reconnectBaseDelayMs: 100,
        reconnectMultiplier: 100,
        reconnectMaxDelayMs: 500,
      });

      transport.connect();
      mockAt(0).simulateOpen();

      for (let i = 0; i < 5; i++) {
        mockAt(i).simulateClose(new CloseEvent('close', { code: 1006 }));
        await vi.advanceTimersByTimeAsync(501);
        expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);
        mockAt(i + 1).simulateClose(new CloseEvent('close', { code: 1006 }));
      }

      transport.dispose();
    });

    it('should stop reconnecting after maxReconnectAttempts', async () => {
      const { transport, mockAt } = createTestTransport({
        manualOpen: true,
        maxReconnectAttempts: 2,
        reconnectBaseDelayMs: 100,
      });

      transport.connect();
      mockAt(0).simulateOpen();

      // Reconnect attempt 1
      mockAt(0).simulateClose(new CloseEvent('close', { code: 1006 }));
      await vi.advanceTimersByTimeAsync(101);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);
      mockAt(1).simulateClose(new CloseEvent('close', { code: 1006 }));

      // Reconnect attempt 2
      await vi.advanceTimersByTimeAsync(201);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);
      mockAt(2).simulateClose(new CloseEvent('close', { code: 1006 }));

      // Attempt 3 exceeds max → should give up
      await vi.advanceTimersByTimeAsync(401);
      expect(transport.state).toBe(WS_CONNECTION_STATE.DISCONNECTED);

      transport.dispose();
    });

    it('should NOT reconnect on intentional disconnect', async () => {
      const { transport } = createTestTransport({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 100,
      });
      await connectTransport(transport);

      transport.disconnect();
      expect(transport.state).toBe(WS_CONNECTION_STATE.DISCONNECTED);

      await vi.advanceTimersByTimeAsync(5000);
      expect(transport.state).toBe(WS_CONNECTION_STATE.DISCONNECTED);
      transport.dispose();
    });

    it('should reset backoff on successful reconnection', async () => {
      const { transport, mockAt } = createTestTransport({
        manualOpen: true,
        maxReconnectAttempts: 5,
        reconnectBaseDelayMs: 100,
        reconnectMultiplier: 2,
      });

      transport.connect();
      mockAt(0).simulateOpen();

      // First failure (delay = 100ms)
      mockAt(0).simulateClose(new CloseEvent('close', { code: 1006 }));
      await vi.advanceTimersByTimeAsync(101);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      // Let it succeed
      mockAt(1).simulateOpen();
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);

      // Second failure (backoff reset → delay = 100ms again)
      mockAt(1).simulateClose(new CloseEvent('close', { code: 1006 }));
      await vi.advanceTimersByTimeAsync(101);
      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTING);

      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------------

  describe('error handling', () => {
    it('should reject all pending requests on uncorrelated server error', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const syncPromise = transport.sendSyncRequest({
        cursor: 'c1',
        mutations: [],
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.ERROR,
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      });

      await expectRejectsWithCode(syncPromise, 'SERVER_ERROR');
      transport.dispose();
    });

    it('should reject pending requests on disconnect', async () => {
      const { transport } = createTestTransport();
      await connectTransport(transport);

      const syncPromise = transport.sendSyncRequest({
        cursor: 'c1',
        mutations: [],
        clientId: 'client-1',
      });

      await vi.advanceTimersByTimeAsync(0);
      transport.disconnect();

      await expectRejectsWithCode(syncPromise, 'DISCONNECTED');
      transport.dispose();
    });

    it('should ignore unknown message types', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      latestMock().simulateMessage({
        type: 'unknown:type',
        data: 'hello',
      });

      expect(transport.state).toBe(WS_CONNECTION_STATE.CONNECTED);
      transport.dispose();
    });

    it('should handle request timeout', async () => {
      const { transport } = createTestTransport();
      await connectTransport(transport);

      const resultPromise = transport.sendSyncRequest({
        cursor: 'c1',
        mutations: [],
        clientId: 'client-1',
      }).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(30_001);

      const result = await resultPromise;
      expect(result).toBeInstanceOf(SyncTransportError);
      if (result instanceof SyncTransportError) {
        expect(result.code).toBe('TIMEOUT');
      }
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Message framing
  // ----------------------------------------------------------------

  describe('message framing', () => {
    it('should assign unique IDs to request messages', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const p1 = transport.sendSyncRequest({
        cursor: 'c1', mutations: [], clientId: 'c1',
      });
      const p2 = transport.sendSyncRequest({
        cursor: 'c2', mutations: [], clientId: 'c1',
      });

      await vi.advanceTimersByTimeAsync(0);

      const all = latestMock().allSentData();
      const parsed1 = JSON.parse(all[0] ?? '');
      const parsed2 = JSON.parse(all[1] ?? '');

      expect(parsed1.id).toBeDefined();
      expect(parsed2.id).toBeDefined();
      expect(parsed1.id).not.toBe(parsed2.id);

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SYNC_RESPONSE,
        id: parsed1.id,
        response: {
          changes: [],
          acknowledgedMutationIds: [],
          conflicts: [],
          newCursor: 'c2',
        },
      });
      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SYNC_RESPONSE,
        id: parsed2.id,
        response: {
          changes: [],
          acknowledgedMutationIds: [],
          conflicts: [],
          newCursor: 'c3',
        },
      });

      await Promise.all([p1, p2]);
      transport.dispose();
    });

    it('should correctly correlate responses to requests regardless of order', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      const p1 = transport.sendSyncRequest({
        cursor: 'c1', mutations: [], clientId: 'c1',
      });
      const p2 = transport.sendSnapshotRequest({ clientId: 'client-1' });

      await vi.advanceTimersByTimeAsync(0);

      const all = latestMock().allSentData();
      const req1 = JSON.parse(all[0] ?? '');
      const req2 = JSON.parse(all[1] ?? '');

      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SNAPSHOT_RESPONSE,
        id: req2.id,
        response: {
          entities: {},
          cursor: 'snap-c',
          serverTimestamp: '2026-08-15T00:00:00Z',
        },
      });
      latestMock().simulateMessage({
        type: WS_MSG_TYPE.SYNC_RESPONSE,
        id: req1.id,
        response: {
          changes: [],
          acknowledgedMutationIds: [],
          conflicts: [],
          newCursor: 'c2',
        },
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.newCursor).toBe('c2');
      expect(r2.cursor).toBe('snap-c');
      transport.dispose();
    });
  });

  // ----------------------------------------------------------------
  // Disconnect and dispose
  // ----------------------------------------------------------------

  describe('disconnect and dispose', () => {
    it('should close the underlying WebSocket on disconnect', async () => {
      const { transport, latestMock } = createTestTransport();
      await connectTransport(transport);

      transport.disconnect();
      expect(latestMock().ws.readyState).toBe(3);
    });

    it('should clear all listeners on dispose', () => {
      const { transport } = createTestTransport();
      const unsub1 = transport.onConnectionStateChange(() => { /* noop */ });
      const unsub2 = transport.onPush(() => { /* noop */ });

      transport.dispose();

      unsub1();
      unsub2();
    });

    it('should handle dispose() without prior connect', () => {
      const { transport } = createTestTransport();
      expect(() => transport.dispose()).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // Type guards (ws-types)
  // ----------------------------------------------------------------

  describe('isWsServerMessage', () => {
    it('should return true for valid server message types', () => {
      expect(isWsServerMessage({ type: WS_MSG_TYPE.VERSION_RESPONSE })).toBe(true);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.SYNC_RESPONSE })).toBe(true);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.SNAPSHOT_RESPONSE })).toBe(true);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.PONG })).toBe(true);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.PUSH_CHANGES })).toBe(true);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.ERROR })).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isWsServerMessage(null)).toBe(false);
      expect(isWsServerMessage(undefined)).toBe(false);
      expect(isWsServerMessage('hello')).toBe(false);
      expect(isWsServerMessage({})).toBe(false);
      expect(isWsServerMessage({ type: 'unknown:type' })).toBe(false);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.PING })).toBe(false);
      expect(isWsServerMessage({ type: WS_MSG_TYPE.SYNC_REQUEST })).toBe(false);
    });
  });
});
