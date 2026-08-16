import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDiscoveryBackend } from '../src/in-memory-discovery-backend.js';
import type { PeerInfo } from '../src/peer-info.js';

function makePeer(overrides?: Partial<PeerInfo>): PeerInfo {
  return {
    id: 'peer-1',
    endpoint: 'ws://192.168.1.10:8080/sync',
    lastSeen: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('InMemoryDiscoveryBackend', () => {
  let backend: InMemoryDiscoveryBackend;

  beforeEach(() => {
    backend = new InMemoryDiscoveryBackend();
  });

  it('should mark backend as started when start is called', async () => {
    expect(backend.isStarted()).toBe(false);
    await backend.start();
    expect(backend.isStarted()).toBe(true);
  });

  it('should mark backend as stopped when stop is called', async () => {
    await backend.start();
    await backend.stop();
    expect(backend.isStarted()).toBe(false);
  });

  it('should notify onPeerFound listeners when a peer is simulated', async () => {
    await backend.start();
    const peer = makePeer();
    const received: PeerInfo[] = [];

    backend.onPeerFound((p) => {
      received.push(p);
    });

    backend.simulatePeerFound(peer);
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('peer-1');
  });

  it('should notify onPeerLost listeners when a peer is simulated as lost', async () => {
    await backend.start();
    const lostIds: string[] = [];

    backend.onPeerLost((id) => {
      lostIds.push(id);
    });

    backend.simulatePeerLost('peer-1');
    expect(lostIds).toEqual(['peer-1']);
  });

  it('should remove listener when cleanup function is called', async () => {
    await backend.start();
    const peer = makePeer();
    const received: PeerInfo[] = [];

    const cleanup = backend.onPeerFound((p) => {
      received.push(p);
    });

    cleanup();
    backend.simulatePeerFound(peer);
    expect(received).toHaveLength(0);
  });
});
