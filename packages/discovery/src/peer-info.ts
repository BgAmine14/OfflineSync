/**
 * @offlinesync/discovery
 *
 * Represents a discovered peer on the local network.
 */

/**
 * Information about a discovered peer.
 *
 * Each peer is uniquely identified by its `id`. When a peer is
 * re-discovered (e.g., via a periodic heartbeat), `lastSeen` is
 * updated but the rest of the information is preserved from the
 * first discovery.
 */
export interface PeerInfo {
  /** Unique identifier for this peer. */
  readonly id: string;
  /** Endpoint URL where the peer can be reached for sync. */
  readonly endpoint: string;
  /** ISO 8601 timestamp of when this peer was last seen on the network. */
  readonly lastSeen: number;
  /** Optional application-specific metadata about the peer. */
  readonly metadata: Readonly<Record<string, string>>;
}
