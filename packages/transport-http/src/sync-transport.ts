/**
 * SyncTransport — protocol-level transport interface for sync operations.
 *
 * This interface defines the contract for any transport that can
 * communicate with a sync server (HTTP, WebSocket, etc.).
 *
 * The interface operates at the protocol level: it sends a SyncRequest
 * and receives a SyncResponse, or sends a SnapshotRequest and
 * receives a SnapshotResponse.
 */

import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
} from '@offlinesync/protocol';

/**
 * Result of a version negotiation request.
 */
export interface VersionInfo {
  /** The negotiated protocol version. */
  readonly version: string;
  /** All versions supported by the server. */
  readonly serverSupportedVersions: string[];
}

/**
 * Protocol-level transport for sync operations.
 *
 * Implementations handle the actual network communication
 * (HTTP, WebSocket, etc.) and return parsed protocol responses.
 */
export interface SyncTransport {
  /**
   * Negotiate the protocol version with the server.
   *
   * @param clientVersions - Versions the client supports.
   * @returns The negotiated version info.
   */
  negotiateVersion(clientVersions: readonly string[]): Promise<VersionInfo>;

  /**
   * Send an incremental sync request.
   *
   * @param request - The sync request with cursor and mutations.
   * @returns The sync response with changes, acknowledgments, and conflicts.
   */
  sendSyncRequest(request: SyncRequest): Promise<SyncResponse>;

  /**
   * Send a snapshot sync request.
   *
   * @param request - The snapshot request with optional collection filter.
   * @returns The snapshot response with all entities.
   */
  sendSnapshotRequest(
    request: SnapshotRequest,
  ): Promise<SnapshotResponse>;
}
