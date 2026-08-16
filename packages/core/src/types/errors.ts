/**
 * Error classification for retry policy.
 *
 * Every sync error must be classified into one of these categories.
 * The classification drives the retry behavior (INV-9).
 */
export const ERROR_CLASSIFICATION = {
  /** Temporary error, retry with exponential backoff */
  TRANSIENT: 'TRANSIENT',
  /** Rate limited, retry after delay */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Conflict detected, do not retry automatically */
  CONFLICT: 'CONFLICT',
  /** Authentication failure, do not retry */
  AUTHENTICATION: 'AUTHENTICATION',
  /** Permanent error, do not retry */
  PERMANENT: 'PERMANENT',
  /** Unknown error, retry conservatively */
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorClassification =
  (typeof ERROR_CLASSIFICATION)[keyof typeof ERROR_CLASSIFICATION];

/**
 * Base error class for all OfflineSync errors.
 */
export class OfflineSyncError extends Error {
  public readonly code: string;

  constructor(message: string, options?: { code: string }) {
    super(message);
    this.name = 'OfflineSyncError';
    this.code = options?.code ?? 'UNKNOWN_ERROR';
  }
}

/**
 * Thrown when a conflict is detected during sync.
 */
export class ConflictResolutionError extends OfflineSyncError {
  public readonly documentId: string;
  public readonly localVersion: number;
  public readonly remoteVersion: number;

  constructor(
    documentId: string,
    localVersion: number,
    remoteVersion: number,
  ) {
    super(
      `Conflict resolution failed for document ${documentId} (local v${localVersion} vs remote v${remoteVersion})`,
      { code: 'CONFLICT_RESOLUTION_FAILED' },
    );
    this.name = 'ConflictResolutionError';
    this.documentId = documentId;
    this.localVersion = localVersion;
    this.remoteVersion = remoteVersion;
  }
}

/**
 * Thrown when sync fails due to a connectivity issue.
 */
export class SyncConnectionError extends OfflineSyncError {
  public readonly classification: ErrorClassification;

  constructor(
    message: string,
    classification: ErrorClassification,
  ) {
    super(message, { code: 'SYNC_CONNECTION_ERROR' });
    this.name = 'SyncConnectionError';
    this.classification = classification;
  }
}

/**
 * Thrown when a sync protocol error occurs.
 */
export class SyncProtocolError extends OfflineSyncError {
  public readonly serverCode: string | undefined;

  constructor(message: string, serverCode?: string) {
    super(message, { code: 'SYNC_PROTOCOL_ERROR' });
    this.name = 'SyncProtocolError';
    this.serverCode = serverCode;
  }
}
