import { describe, it, expect, beforeEach } from 'vitest';
import { DiscoveryService, DISCOVERY_STATE } from '../src/discovery-service.js';
import { DiscoveryError } from '../src/discovery-error.js';
import { InMemoryDiscoveryBackend } from '../src/in-memory-discovery-backend.js';
import type { DiscoveryBackend, OnPeerFound, OnPeerLost } from '../src/discovery-backend.js';
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

function makeBackendThatFailsOnStart(): DiscoveryBackend {
  return {
    start: async (): Promise<void> => {
      throw new Error('network error');
    },
    stop: async (): Promise<void> => {
      // intentional no-op for test stub
    },
    onPeerFound: (_callback: OnPeerFound): (() => void) => {
      return () => {
        // intentional no-op for test stub
      };
    },
    onPeerLost: (_callback: OnPeerLost): (() => void) => {
      return () => {
        // intentional no-op for test stub
      };
    },
  };
}

function makeBackendThatFailsOnStop(): DiscoveryBackend & {
 invokePeerFound: (peer: PeerInfo) => void;
} {
  let foundListener: OnPeerFound | null = null;
  return {
    start: async (): Promise<void> => {
      foundListener = () => {
        // intentional no-op for test stub
      };
    },
    stop: async () => {
      throw new Error('stop failed');
    },
    onPeerFound: (callback: OnPeerFound) => {
      foundListener = callback;
      return () => {
        foundListener = null;
      };
    },
    onPeerLost: (_callback: OnPeerLost): (() => void) => {
      return () => {
        // intentional no-op for test stub
      };
    },
    invokePeerFound: (peer: PeerInfo) => {
      if (foundListener !== null) {
        foundListener(peer);
      }
    },
  };
}

describe('DiscoveryService', () => {
  let backend: InMemoryDiscoveryBackend;
  let service: DiscoveryService;

  beforeEach(() => {
    backend = new InMemoryDiscoveryBackend();
    service = new DiscoveryService(backend);
  });

  // ----------------------------------------------------------------
  // Lifecycle: start / stop / dispose
  // ----------------------------------------------------------------

  it('should transition to started state when start is called', async () => {
    await service.start();
    expect(service.getState()).toBe(DISCOVERY_STATE.STARTED);
  });

  it('should transition back to stopped state when stop is called', async () => {
    await service.start();
    await service.stop();
    expect(service.getState()).toBe(DISCOVERY_STATE.STOPPED);
  });

  it('should be a no-op when start is called while already started', async () => {
    await service.start();
    await service.start();
    expect(service.getState()).toBe(DISCOVERY_STATE.STARTED);
  });

  it('should be a no-op when stop is called while already stopped', async () => {
    await service.stop();
    expect(service.getState()).toBe(DISCOVERY_STATE.STOPPED);
  });

  it('should transition to disposed state after dispose', async () => {
    await service.dispose();
    expect(service.getState()).toBe(DISCOVERY_STATE.DISPOSED);
  });

  it('should throw DiscoveryError when start is called after dispose', async () => {
    await service.dispose();
    await expect(service.start()).rejects.toThrow(DiscoveryError);
    await expect(service.start()).rejects.toThrow('DISCOVERY_DISPOSED');
  });

  it('should wrap backend start errors in DiscoveryError', async () => {
    const failingBackend = makeBackendThatFailsOnStart();
    const failingService = new DiscoveryService(failingBackend);

    await expect(failingService.start()).rejects.toThrow(DiscoveryError);
    await expect(failingService.start()).rejects.toThrow(
      'DISCOVERY_START_FAILED',
    );
    expect(failingService.getState()).toBe(DISCOVERY_STATE.STOPPED);
  });

  it('should wrap backend stop errors in DiscoveryError but still clean up', async () => {
    const failingBackend = makeBackendThatFailsOnStop();
    const failingService = new DiscoveryService(failingBackend);

    await failingService.start();
    await expect(failingService.stop()).rejects.toThrow(DiscoveryError);
    // Even on error, state should return to stopped
    expect(failingService.getState()).toBe(DISCOVERY_STATE.STOPPED);
  });

  it('should stop the backend when disposed while started', async () => {
    await service.start();
    await service.dispose();
    expect(backend.isStarted()).toBe(false);
  });

  // ----------------------------------------------------------------
  // Peer discovery
  // ----------------------------------------------------------------

  it('should return empty peers before any discovery', () => {
    expect(service.getPeers()).toEqual([]);
  });

  it('should track a peer after the backend discovers one', async () => {
    await service.start();
    const peer = makePeer();
    backend.simulatePeerFound(peer);

    const peers = service.getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.id).toBe('peer-1');
    expect(peers[0]?.endpoint).toBe('ws://192.168.1.10:8080/sync');
  });

  it('should invoke onPeerDiscovered when a new peer is found', async () => {
    await service.start();
    const peer = makePeer();
    const discovered: PeerInfo[] = [];

    service.onPeerDiscovered((p) => {
      discovered.push(p);
    });

    backend.simulatePeerFound(peer);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.id).toBe('peer-1');
  });

  it('should not invoke onPeerDiscovered for a duplicate peer', async () => {
    await service.start();
    const peer = makePeer();
    const discovered: PeerInfo[] = [];

    service.onPeerDiscovered((p) => {
      discovered.push(p);
    });

    backend.simulatePeerFound(peer);
    backend.simulatePeerFound(peer);

    expect(discovered).toHaveLength(1);
  });

  it('should update lastSeen when a duplicate peer is re-discovered', async () => {
    await service.start();
    const firstSeen = 1000;
    const secondSeen = 2000;

    backend.simulatePeerFound(makePeer({ lastSeen: firstSeen }));
    backend.simulatePeerFound(makePeer({ lastSeen: secondSeen }));

    const peers = service.getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.lastSeen).toBe(secondSeen);
  });

  // ----------------------------------------------------------------
  // Peer loss
  // ----------------------------------------------------------------

  it('should remove a peer when the backend reports it lost', async () => {
    await service.start();
    backend.simulatePeerFound(makePeer());
    expect(service.getPeers()).toHaveLength(1);

    backend.simulatePeerLost('peer-1');
    expect(service.getPeers()).toHaveLength(0);
  });

  it('should invoke onPeerLost when a known peer is lost', async () => {
    await service.start();
    backend.simulatePeerFound(makePeer());
    const lostIds: string[] = [];

    service.onPeerLost((id) => {
      lostIds.push(id);
    });

    backend.simulatePeerLost('peer-1');
    expect(lostIds).toEqual(['peer-1']);
  });

  it('should not invoke onPeerLost for an unknown peer', async () => {
    await service.start();
    const lostIds: string[] = [];

    service.onPeerLost((id) => {
      lostIds.push(id);
    });

    backend.simulatePeerLost('unknown-peer');
    expect(lostIds).toEqual([]);
  });

  // ----------------------------------------------------------------
  // Callback cleanup
  // ----------------------------------------------------------------

  it('should stop receiving events after onPeerDiscovered cleanup', async () => {
    await service.start();
    const peer = makePeer();
    const discovered: PeerInfo[] = [];

    const cleanup = service.onPeerDiscovered((p) => {
      discovered.push(p);
    });

    cleanup();
    backend.simulatePeerFound(peer);
    expect(discovered).toHaveLength(0);
  });

  it('should stop receiving events after onPeerLost cleanup', async () => {
    await service.start();
    backend.simulatePeerFound(makePeer());
    const lostIds: string[] = [];

    const cleanup = service.onPeerLost((id) => {
      lostIds.push(id);
    });

    cleanup();
    backend.simulatePeerLost('peer-1');
    expect(lostIds).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Stop clears state
  // ----------------------------------------------------------------

  it('should clear all peers when stop is called', async () => {
    await service.start();
    backend.simulatePeerFound(makePeer());
    backend.simulatePeerFound(
      makePeer({ id: 'peer-2', endpoint: 'ws://192.168.1.11:8080/sync' }),
    );
    expect(service.getPeers()).toHaveLength(2);

    await service.stop();
    expect(service.getPeers()).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Dispose clears listeners
  // ----------------------------------------------------------------

  it('should clear all listeners when dispose is called', async () => {
    await service.start();
    const discovered: PeerInfo[] = [];

    service.onPeerDiscovered((p) => {
      discovered.push(p);
    });

    await service.dispose();
    backend.simulatePeerFound(makePeer());
    expect(discovered).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Multiple peers
  // ----------------------------------------------------------------

  it('should track multiple peers', async () => {
    await service.start();

    backend.simulatePeerFound(
      makePeer({ id: 'peer-1', endpoint: 'ws://192.168.1.10:8080/sync' }),
    );
    backend.simulatePeerFound(
      makePeer({ id: 'peer-2', endpoint: 'ws://192.168.1.11:8080/sync' }),
    );
    backend.simulatePeerFound(
      makePeer({ id: 'peer-3', endpoint: 'ws://192.168.1.12:8080/sync' }),
    );

    const peers = service.getPeers();
    expect(peers).toHaveLength(3);
    const ids = peers.map((p) => p.id);
    expect(ids).toContain('peer-1');
    expect(ids).toContain('peer-2');
    expect(ids).toContain('peer-3');
  });

  it('should invoke onPeerDiscovered for each new peer', async () => {
    await service.start();
    const discovered: PeerInfo[] = [];

    service.onPeerDiscovered((p) => {
      discovered.push(p);
    });

    backend.simulatePeerFound(
      makePeer({ id: 'peer-1', endpoint: 'ws://192.168.1.10:8080/sync' }),
    );
    backend.simulatePeerFound(
      makePeer({ id: 'peer-2', endpoint: 'ws://192.168.1.11:8080/sync' }),
    );

    expect(discovered).toHaveLength(2);
  });
});
