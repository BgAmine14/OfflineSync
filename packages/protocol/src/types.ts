/**
 * Core protocol type constants.
 *
 * These are defined as const objects (not enums) per project conventions.
 * They represent the fixed vocabulary of the wire protocol.
 */

/**
 * Error codes returned by the sync protocol.
 * Maps 1:1 to HTTP status codes and error classification behavior.
 */
export const SYNC_ERROR_CODE = {
  /** The provided cursor is too old; client must perform a snapshot sync */
  CURSOR_TOO_OLD: 'CURSOR_TOO_OLD',
  /** Authentication failed; do not retry without user intervention */
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  /** Rate limit exceeded; retry after the delay specified by the server */
  RATE_LIMITED: 'RATE_LIMITED',
  /** The request format is invalid; do not retry */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** An unexpected server error occurred; retry with backoff */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** An unclassified error; retry conservatively */
  UNKNOWN: 'UNKNOWN',
} as const;

/** Union type of all sync error codes */
export type SyncErrorCode = (typeof SYNC_ERROR_CODE)[keyof typeof SYNC_ERROR_CODE];

/**
 * Classification of a sync error.
 * Determines whether and how the client should retry.
 */
export const ERROR_CLASSIFICATION = {
  /** Temporary error; retry with exponential backoff */
  TRANSIENT: 'TRANSIENT',
  /** Rate limited; retry after the delay specified by the server */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Conflict detected; do not retry, invoke conflict resolution */
  CONFLICT: 'CONFLICT',
  /** Authentication failure; do not retry without user intervention */
  AUTHENTICATION: 'AUTHENTICATION',
  /** Permanent error; do not retry */
  PERMANENT: 'PERMANENT',
  /** Unknown error; retry conservatively with long backoff */
  UNKNOWN: 'UNKNOWN',
} as const;

/** Union type of all error classifications */
export type ErrorClassification =
  (typeof ERROR_CLASSIFICATION)[keyof typeof ERROR_CLASSIFICATION];
