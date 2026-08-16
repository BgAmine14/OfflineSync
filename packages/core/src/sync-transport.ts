/**
 * SyncTransport — protocol-level transport interface for sync operations.
 *
 * The canonical definition lives in @offlinesync/transport-http.
 * This module re-exports it for convenience and provides StubSyncTransport for testing.
 */

export type { SyncTransport, VersionInfo } from '@offlinesync/transport-http';

import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
} from '@offlinesync/protocol';
import type { SyncTransport, VersionInfo } from '@offlinesync/transport-http';

/**
 * A stub SyncTransport for testing.
 * Records calls and returns configurable responses.
 */
export class StubSyncTransport implements SyncTransport {
  private lastSyncRequest: SyncRequest | null = null;
  private lastSnapshotRequest: SnapshotRequest | null = null;
  private nextSyncResponse: SyncResponse | null = null;
  private nextSnapshotResponse: SnapshotResponse | null = null;
  private nextVersionInfo: VersionInfo | null = null;
  private nextError: Error | null = null;

  async negotiateVersion(
    _clientVersions: readonly string[],
  ): Promise<VersionInfo> {
    if (this.nextError !== null) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    if (this.nextVersionInfo === null) {
      return { version: '1.0', serverSupportedVersions: ['1.0'] };
    }
    const info = this.nextVersionInfo;
    this.nextVersionInfo = null;
    return info;
  }

  async sendSyncRequest(request: SyncRequest): Promise<SyncResponse> {
    this.lastSyncRequest = request;
    if (this.nextError !== null) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    if (this.nextSyncResponse === null) {
      return {
        changes: [],
        acknowledgedMutationIds: [],
        conflicts: [],
        newCursor: 'stub-cursor',
      };
    }
    const response = this.nextSyncResponse;
    this.nextSyncResponse = null;
    return response;
  }

  async sendSnapshotRequest(
    request: SnapshotRequest,
  ): Promise<SnapshotResponse> {
    this.lastSnapshotRequest = request;
    if (this.nextError !== null) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    if (this.nextSnapshotResponse === null) {
      return {
        entities: {},
        cursor: 'stub-cursor',
        serverTimestamp: new Date().toISOString(),
      };
    }
    const response = this.nextSnapshotResponse;
    this.nextSnapshotResponse = null;
    return response;
  }

  // --- Test controls ---

  getLastSyncRequest(): SyncRequest | null {
    return this.lastSyncRequest;
  }

  getLastSnapshotRequest(): SnapshotRequest | null {
    return this.lastSnapshotRequest;
  }

  setNextSyncResponse(response: SyncResponse): void {
    this.nextSyncResponse = response;
  }

  setNextSnapshotResponse(response: SnapshotResponse): void {
    this.nextSnapshotResponse = response;
  }

  setNextVersionInfo(info: VersionInfo): void {
    this.nextVersionInfo = info;
  }

  failNext(error: Error): void {
    this.nextError = error;
  }

  reset(): void {
    this.lastSyncRequest = null;
    this.lastSnapshotRequest = null;
    this.nextSyncResponse = null;
    this.nextSnapshotResponse = null;
    this.nextVersionInfo = null;
    this.nextError = null;
  }
}
