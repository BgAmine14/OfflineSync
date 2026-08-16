/**
 * @offlinesync/discovery
 *
 * Pluggable LAN peer discovery for peer-to-peer sync.
 *
 * Provides a {@link DiscoveryService} that wraps a pluggable
 * {@link DiscoveryBackend} to discover peers on the local network.
 * An {@link InMemoryDiscoveryBackend} is included for testing.
 *
 * @example
 * ```typescript
 * import { DiscoveryService, InMemoryDiscoveryBackend } from '@offlinesync/discovery';
 *
 * const backend = new InMemoryDiscoveryBackend();
 * const service = new DiscoveryService(backend);
 *
 * service.onPeerDiscovered((peer) => {
 *   console.log(`Found: ${peer.id} at ${peer.endpoint}`);
 * });
 *
 * await service.start();
 * ```
 */

// Types
export type { PeerInfo } from './peer-info.js';
export type {
  DiscoveryBackend,
  OnPeerFound,
  OnPeerLost,
} from './discovery-backend.js';
export type {
  OnPeerDiscovered,
  OnPeerLostCallback,
  DiscoveryState,
} from './discovery-service.js';

// Classes
export { DiscoveryError } from './discovery-error.js';
export { DiscoveryService, DISCOVERY_STATE } from './discovery-service.js';
export { InMemoryDiscoveryBackend } from './in-memory-discovery-backend.js';
