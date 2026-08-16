/**
 * @offlinesync/discovery
 *
 * High-level service for discovering peers on the local network.
 *
 * Delegates the actual network scanning to a pluggable {@link DiscoveryBackend}.
 * Maintains an internal peer registry, emits discovery/loss events, and
 * handles duplicate peer detection.
 */

import type { PeerInfo } from './peer-info.js';
import type {
  DiscoveryBackend,
  OnPeerFound,
  OnPeerLost,
} from './discovery-backend.js';
import { DiscoveryError } from './discovery-error.js';

/**
 * Callback invoked when a peer is discovered for the first time.
 */
export type OnPeerDiscovered = (peer: PeerInfo) => void;

/**
 * Callback invoked when a previously discovered peer is lost.
 */
export type OnPeerLostCallback = (peerId: string) => void;

/**
 * Discovery state constants.
 */
export const DISCOVERY_STATE = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  STARTED: 'started',
  STOPPING: 'stopping',
  DISPOSED: 'disposed',
} as const;

/**
 * Possible states of the {@link DiscoveryService}.
 */
export type DiscoveryState =
  (typeof DISCOVERY_STATE)[keyof typeof DISCOVERY_STATE];

/**
 * Service that discovers peers on the local network for peer-to-peer sync.
 *
 * Wraps a pluggable {@link DiscoveryBackend} and provides:
 * - Peer registry with duplicate detection
 * - Lifecycle management (start/stop/dispose)
 * - High-level callbacks for peer discovery and loss
 *
 * @example
 * ```typescript
 * const backend = new InMemoryDiscoveryBackend();
 * const service = new DiscoveryService(backend);
 *
 * service.onPeerDiscovered((peer) => {
 *   console.log(`Found peer: ${peer.id} at ${peer.endpoint}`);
 * });
 *
 * service.onPeerLost((peerId) => {
 *   console.log(`Lost peer: ${peerId}`);
 * });
 *
 * await service.start();
 * // ... peers are discovered via the backend ...
 * await service.stop();
 * ```
 */
export class DiscoveryService {
  private readonly backend: DiscoveryBackend;
  private peers = new Map<string, PeerInfo>();
  private peerDiscoveredListeners = new Set<OnPeerDiscovered>();
  private peerLostListeners = new Set<OnPeerLostCallback>();
  private state: DiscoveryState = DISCOVERY_STATE.STOPPED;
  private disposed = false;

  /** Cleanup functions returned by the backend's listener registration. */
  private cleanupOnPeerFound: (() => void) | null = null;
  private cleanupOnPeerLost: (() => void) | null = null;

  constructor(backend: DiscoveryBackend) {
    this.backend = backend;
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /**
   * Start peer discovery.
   *
   * Starts the underlying backend and registers internal listeners.
   * If the service is already started, this is a no-op.
   *
   * @throws {DiscoveryError} If the service has been disposed.
   */
  async start(): Promise<void> {
    if (this.disposed) {
      throw new DiscoveryError(
        'DISCOVERY_DISPOSED',
        'Cannot start: discovery service has been disposed',
      );
    }

    if (this.state === DISCOVERY_STATE.STARTED) {
      return;
    }

    this.setState(DISCOVERY_STATE.STARTING);

    try {
      this.cleanupOnPeerFound = this.backend.onPeerFound(
        this.handlePeerFound,
      );
      this.cleanupOnPeerLost = this.backend.onPeerLost(
        this.handlePeerLost,
      );

      await this.backend.start();
      this.setState(DISCOVERY_STATE.STARTED);
    } catch (error) {
      this.cleanupBackendListeners();
      this.setState(DISCOVERY_STATE.STOPPED);
      throw new DiscoveryError(
        'DISCOVERY_START_FAILED',
        'Failed to start discovery',
        { cause: error },
      );
    }
  }

  /**
   * Stop peer discovery.
   *
   * Stops the underlying backend and clears the peer registry.
   * If the service is already stopped, this is a no-op.
   */
  async stop(): Promise<void> {
    if (this.state === DISCOVERY_STATE.STOPPED) {
      return;
    }

    this.setState(DISCOVERY_STATE.STOPPING);

    try {
      await this.backend.stop();
    } catch (error) {
      throw new DiscoveryError(
        'DISCOVERY_STOP_FAILED',
        'Failed to stop discovery',
        { cause: error },
      );
    } finally {
      this.cleanupBackendListeners();
      this.peers.clear();
      this.setState(DISCOVERY_STATE.STOPPED);
    }
  }

  /**
   * Permanently dispose of the discovery service.
   *
   * Stops discovery if running, clears all listeners and peer state,
   * and prevents any future operations.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.state === DISCOVERY_STATE.STARTED) {
      try {
        await this.backend.stop();
      } catch {
        // Best-effort stop during disposal
      }
    }

    this.cleanupBackendListeners();
    this.peers.clear();
    this.peerDiscoveredListeners.clear();
    this.peerLostListeners.clear();
    this.setState(DISCOVERY_STATE.DISPOSED);
  }

  // ----------------------------------------------------------------
  // Event subscription
  // ----------------------------------------------------------------

  /**
   * Register a callback invoked when a new peer is discovered.
   *
   * If a peer with the same ID is already known, the callback
   * is NOT invoked again (the peer is simply updated).
   *
   * @param callback - Function called with the discovered peer info.
   * @returns A cleanup function that removes the callback.
   */
  onPeerDiscovered(callback: OnPeerDiscovered): () => void {
    this.peerDiscoveredListeners.add(callback);
    return () => {
      this.peerDiscoveredListeners.delete(callback);
    };
  }

  /**
   * Register a callback invoked when a previously discovered peer is lost.
   *
   * @param callback - Function called with the lost peer's ID.
   * @returns A cleanup function that removes the callback.
   */
  onPeerLost(callback: OnPeerLostCallback): () => void {
    this.peerLostListeners.add(callback);
    return () => {
      this.peerLostListeners.delete(callback);
    };
  }

  // ----------------------------------------------------------------
  // Querying
  // ----------------------------------------------------------------

  /**
   * Return a snapshot of all currently known peers.
   *
   * The returned array is a copy; mutating it does not affect
   * the service's internal state.
   *
   * @returns An array of currently known peers.
   */
  getPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  /**
   * The current discovery state.
   */
  getState(): DiscoveryState {
    return this.state;
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  private readonly handlePeerFound: OnPeerFound = (peer: PeerInfo): void => {
    const isNew = !this.peers.has(peer.id);

    this.peers.set(peer.id, {
      ...peer,
      lastSeen: peer.lastSeen,
    });

    if (isNew) {
      for (const listener of this.peerDiscoveredListeners) {
        listener(peer);
      }
    }
  };

  private readonly handlePeerLost: OnPeerLost = (peerId: string): void => {
    const existed = this.peers.delete(peerId);

    if (existed) {
      for (const listener of this.peerLostListeners) {
        listener(peerId);
      }
    }
  };

  private cleanupBackendListeners(): void {
    if (this.cleanupOnPeerFound !== null) {
      this.cleanupOnPeerFound();
      this.cleanupOnPeerFound = null;
    }
    if (this.cleanupOnPeerLost !== null) {
      this.cleanupOnPeerLost();
      this.cleanupOnPeerLost = null;
    }
  }

  private setState(state: DiscoveryState): void {
    this.state = state;
  }
}
