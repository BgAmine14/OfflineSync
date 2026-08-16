/**
 * HttpSyncTransport — HTTP implementation of SyncTransport.
 *
 * Uses the global fetch API (available in Node 18+, Deno, Bun, browsers).
 * No external HTTP library is needed.
 *
 * The transport handles:
 * - JSON serialization/deserialization
 * - Protocol version negotiation (GET /sync/versions)
 * - Incremental sync (POST /sync/incremental)
 * - Snapshot sync (POST /sync/snapshot)
 * - Error response parsing and CURSOR_TOO_OLD detection
 */

import type {
  SyncRequest,
  SyncResponse,
  SnapshotRequest,
  SnapshotResponse,
} from '@offlinesync/protocol';
import {
  isSyncResponse,
  isSnapshotResponse,
  isProtocolError,
  SYNC_ERROR_CODE,
} from '@offlinesync/protocol';
import type { SyncTransport, VersionInfo } from './sync-transport.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Configuration options for HttpSyncTransport.
 */
export interface HttpTransportOptions {
  /** Base URL of the sync server (e.g., 'https://api.example.com'). */
  readonly serverUrl: string;
  /**
   * Optional headers to include in every request.
   * Useful for authentication tokens.
   */
  readonly headers?: Record<string, string>;
  /**
   * AbortSignal for cancelling in-flight requests.
   */
  readonly signal?: AbortSignal;
}

/**
 * Error thrown when the server returns a protocol-level error.
 */
export class SyncTransportError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SyncTransportError';
    this.code = code;
    this.details = details;
  }
}

/**
 * HTTP implementation of the sync transport.
 *
 * @example
 * ```typescript
 * const transport = new HttpSyncTransport({
 *   serverUrl: 'https://api.example.com',
 *   headers: { Authorization: 'Bearer <token>' },
 * });
 * ```
 */
export class HttpSyncTransport implements SyncTransport {
  private readonly serverUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly signal?: AbortSignal;

  constructor(options: HttpTransportOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.defaultHeaders = options.headers ?? {};
    this.signal = options.signal;
  }

  /**
   * Negotiate protocol version with the server.
   */
  async negotiateVersion(
    clientVersions: readonly string[],
  ): Promise<VersionInfo> {
    const url = `${this.serverUrl}/sync/versions`;
    const response = await this.fetch(url);

    const body = await response.json() as {
      supportedVersions: string[];
    };

    // Simple negotiation: find highest common version
    const serverSet = new Set(body.supportedVersions);
    const common = clientVersions.filter((v) => serverSet.has(v));

    if (common.length === 0) {
      throw new SyncTransportError(
        'NO_COMMON_VERSION',
        'No common protocol version between client and server',
        { clientVersions: [...clientVersions], serverVersions: body.supportedVersions },
      );
    }

    // Sort by semver and pick highest
    common.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      const aMaj = aParts[0] ?? 0;
      const bMaj = bParts[0] ?? 0;
      if (aMaj !== bMaj) return aMaj - bMaj;
      const aMin = aParts[1] ?? 0;
      const bMin = bParts[1] ?? 0;
      return aMin - bMin;
    });

    return {
      version: common[common.length - 1] ?? '',
      serverSupportedVersions: body.supportedVersions,
    };
  }

  /**
   * Send an incremental sync request.
   */
  async sendSyncRequest(request: SyncRequest): Promise<SyncResponse> {
    const url = `${this.serverUrl}/sync/incremental`;
    const response = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return this.parseSyncResponse(response);
  }

  /**
   * Send a snapshot sync request.
   */
  async sendSnapshotRequest(
    request: SnapshotRequest,
  ): Promise<SnapshotResponse> {
    const url = `${this.serverUrl}/sync/snapshot`;
    const response = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return this.parseSnapshotResponse(response);
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  private async fetch(
    url: string,
    options?: { method?: string; body?: string },
  ): Promise<Response> {
    const response = await globalThis.fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
      },
      body: options?.body,
      signal: this.signal,
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    return response;
  }

  private async parseSyncResponse(
    response: Response,
  ): Promise<SyncResponse> {
    const body = await response.json() as unknown;

    if (isProtocolError(body)) {
      throw new SyncTransportError(
        body.code,
        body.message,
        body.details,
      );
    }

    if (!isSyncResponse(body)) {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.INVALID_REQUEST,
        'Invalid sync response from server',
      );
    }

    return body;
  }

  private async parseSnapshotResponse(
    response: Response,
  ): Promise<SnapshotResponse> {
    const body = await response.json() as unknown;

    if (isProtocolError(body)) {
      throw new SyncTransportError(
        body.code,
        body.message,
        body.details,
      );
    }

    if (!isSnapshotResponse(body)) {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.INVALID_REQUEST,
        'Invalid snapshot response from server',
      );
    }

    return body;
  }

  private async handleHttpError(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SyncTransportError(
        SYNC_ERROR_CODE.UNKNOWN,
        `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    // The server may wrap the error in an 'error' property
    const protocolError =
      isProtocolError(body) ? body :
      (isObject(body) && 'error' in body && isProtocolError((body as Record<string, unknown>)['error']))
        ? (body as Record<string, unknown>)['error'] as { code: string; message: string; details?: Record<string, unknown> }
        : null;

    if (protocolError !== null) {
      throw new SyncTransportError(
        protocolError.code,
        protocolError.message,
        protocolError.details,
      );
    }

    throw new SyncTransportError(
      SYNC_ERROR_CODE.UNKNOWN,
      `HTTP ${response.status}: ${response.statusText}`,
    );
  }
}
