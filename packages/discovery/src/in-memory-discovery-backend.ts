/**
 * @offlinesync/discovery
 *
 * In-memory discovery backend for testing.
 *
 * Simulates peer discovery without any real network activity.
 * Peers are manually injected via {@link simulatePeerFound}
 * and removed via {@link simulatePeerLost}.
 */

import type { PeerInfo } from './peer-info.js';
import type {
  DiscoveryBackend,
  OnPeerFound,
  OnPeerLost,
} from './discovery-backend.js';

/**
 * A fake discovery backend that operates entirely in memory.
 *
 * Useful for unit testing {@link DiscoveryService} without
 * requiring real network hardware or mDNS daemons.
 *
 * @example
 * ```typescript
 * const backend = new InMemoryDiscoveryBackend();
 * const service = new DiscoveryService(backend);
 *
 * await service.start();
 * backend.simulatePeerFound({
 *   id: 'peer-1',
 *   endpoint: 'ws://192.168.1.10:8080/sync',
 *   lastSeen: Date.now(),
 *   metadata: { device: 'laptop' },
 * });
 * ```
 */
export class InMemoryDiscoveryBackend implements DiscoveryBackend {
  private peerFoundListeners = new Set<OnPeerFound>();
  private peerLostListeners = new Set<OnPeerLost>();
  private started = false;

  /**
 * Start the in-memory backend.
 *
 * Marks the backend as active. No actual network scanning occurs.
 */
  async start(): Promise<void> {
    this.started = true;
  }

  /**
 * Stop the in-memory backend.
 *
 * Marks the backend as inactive and clears all registered listeners.
 */
  async stop(): Promise<void> {
    this.started = false;
    this.peerFoundListeners.clear();
    this.peerLostListeners.clear();
  }

  onPeerFound(callback: OnPeerFound): () => void {
    this.peerFoundListeners.add(callback);
    return () => {
      this.peerFoundListeners.delete(callback);
    };
  }

  onPeerLost(callback: OnPeerLost): () => void {
    this.peerLostListeners.add(callback);
    return () => {
      this.peerLostListeners.delete(callback);
    };
  }

  /**
 * Returns whether the backend is currently started.
 */
  isStarted(): boolean {
    return this.started;
  }

  /**
 * Simulate a peer being discovered.
 *
 * Notifies all registered {@link OnPeerFound} listeners.
 *
 * @param peer - The peer information to broadcast.
 */
  simulatePeerFound(peer: PeerInfo): void {
    for (const listener of this.peerFoundListeners) {
      listener(peer);
    }
  }

  /**
 * Simulate a peer being lost.
 *
 * Notifies all registered {@link OnPeerLost} listeners.
 *
 * @param peerId - The ID of the peer that is no longer reachable.
 */
  simulatePeerLost(peerId: string): void {
    for (const listener of this.peerLostListeners) {
      listener(peerId);
    }
  }
}
