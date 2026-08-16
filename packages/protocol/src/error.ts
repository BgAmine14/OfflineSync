/**
 * Error response types for the sync protocol.
 *
 * All protocol errors follow a consistent format with a code,
 * human-readable message, and optional structured details.
 */

import type { SyncErrorCode, ErrorClassification } from './types.js';

/**
 * Structured error returned by the sync protocol.
 *
 * Error responses wrap the `error` field in the top-level response body.
 * The `code` determines the HTTP status and retry behavior (INV-9).
 */
export interface ProtocolError {
  /** Machine-readable error code from the SYNC_ERROR_CODE vocabulary */
  code: SyncErrorCode;

  /** Human-readable error message */
  message: string;

  /**
   * Optional structured error details.
   * The shape depends on the error code:
   * - CURSOR_TOO_OLD: { minimumAvailableCursor: string }
   * - RATE_LIMITED: { retryAfterSeconds: number }
   * - INVALID_REQUEST: { fields: string[] }
   */
  details?: Record<string, unknown>;
}

/**
 * Mapping from SyncErrorCode to ErrorClassification.
 * This determines retry behavior (INV-9).
 */
export const ERROR_CODE_CLASSIFICATION: Readonly<
  Record<SyncErrorCode, ErrorClassification>
> = {
  CURSOR_TOO_OLD: 'TRANSIENT',
  AUTHENTICATION_FAILED: 'AUTHENTICATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'PERMANENT',
  INTERNAL_ERROR: 'TRANSIENT',
  UNKNOWN: 'UNKNOWN',
} as const;

/**
 * Mapping from SyncErrorCode to the HTTP status code
 * that the server should return.
 */
export const ERROR_CODE_HTTP_STATUS: Readonly<
  Record<SyncErrorCode, number>
> = {
  CURSOR_TOO_OLD: 409,
  AUTHENTICATION_FAILED: 401,
  RATE_LIMITED: 429,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
  UNKNOWN: 500,
} as const;

/**
 * Mapping from ErrorClassification to retry behavior.
 */
export const CLASSIFICATION_RETRY_BEHAVIOR: Readonly<
  Record<
    ErrorClassification,
    { shouldRetry: boolean; description: string }
  >
> = {
  TRANSIENT: {
    shouldRetry: true,
    description: 'Retry with exponential backoff',
  },
  RATE_LIMITED: {
    shouldRetry: true,
    description: 'Retry after the delay specified by the server',
  },
  CONFLICT: {
    shouldRetry: false,
    description: 'Do not retry; invoke conflict resolution',
  },
  AUTHENTICATION: {
    shouldRetry: false,
    description: 'Do not retry; user intervention required',
  },
  PERMANENT: {
    shouldRetry: false,
    description: 'Do not retry; notify application',
  },
  UNKNOWN: {
    shouldRetry: true,
    description: 'Retry conservatively with long backoff',
  },
} as const;
