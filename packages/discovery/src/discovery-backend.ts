/**
 * @offlinesync/discovery
 *
 * Pluggable backend interface for peer discovery.
 *
 * Concrete implementations (mDNS, WebRTC, Bluetooth, etc.) implement
 * this interface to provide the actual network discovery mechanism.
 * The {@link DiscoveryService} delegates all network operations to
 * whatever backend is provided.
 */

import type { PeerInfo } from './peer-info.js';

/**
 * Callback invoked when a new peer is found by the backend.
 */
export type OnPeerFound = (peer: PeerInfo) => void;

/**
 * Callback invoked when a previously discovered peer is no longer reachable.
 */
export type OnPeerLost = (peerId: string) => void;

/**
 * Abstraction over a discovery protocol.
 *
 * Implementations are responsible for the actual network-level peer
 * detection (e.g., mDNS browsing, WebRTC signaling, etc.). When a peer
 * is found or lost, the backend invokes the registered callbacks.
 */
export interface DiscoveryBackend {
  /**
   * Start the discovery process.
   *
   * After this resolves, the backend should be actively scanning for peers.
   * Callbacks registered via {@link onPeerFound} and {@link onPeerLost} may
   * be invoked at any time after start completes.
   */
  start(): Promise<void>;

  /**
   * Stop the discovery process.
   *
   * After this resolves, the backend should no longer invoke any
   * callbacks and should release all network resources.
   */
  stop(): Promise<void>;

  /**
   * Register a callback invoked when a new peer is discovered.
   *
   * @param callback - Function called with the discovered peer info.
   * @returns A cleanup function that removes the callback.
   */
  onPeerFound(callback: OnPeerFound): () => void;

  /**
   * Register a callback invoked when a previously discovered peer
   * is no longer reachable.
   *
   * @param callback - Function called with the lost peer's ID.
   * @returns A cleanup function that removes the callback.
   */
  onPeerLost(callback: OnPeerLost): () => void;
}
