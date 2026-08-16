/**
 * Error classification for sync retry behavior (INV-9).
 *
 * Every sync error must be classified into one of six categories.
 * The classification determines whether and how to retry.
 */

import type { ErrorClassification } from './types/index.js';
import { ERROR_CLASSIFICATION } from './types/index.js';

/**
 * Classification result with optional retry metadata.
 */
export interface ClassifiedError {
  /** The error classification. */
  readonly classification: ErrorClassification;
  /** Suggested retry delay in milliseconds (0 = retry immediately). */
  readonly retryAfterMs: number;
}

/**
 * Classifies sync errors into retry categories.
 *
 * Classification rules (INV-9):
 * - TRANSIENT: Network timeouts, DNS failures, temporary server errors → retry with exponential backoff
 * - RATE_LIMITED: HTTP 429, server rate limiting → retry after Retry-After header
 * - CONFLICT: Revision mismatch → do not retry automatically
 * - AUTHENTICATION: Invalid/expired credentials → do not retry
 * - PERMANENT: HTTP 404, 400, data validation errors → do not retry
 * - UNKNOWN: Unclassified → retry conservatively
 *
 * @example
 * ```typescript
 * const classifier = new ErrorClassifier();
 * const result = classifier.classify(error);
 * if (result.classification === ERROR_CLASSIFICATION.TRANSIENT) {
 *   await backoff(result.retryAfterMs);
 *   await retry();
 * }
 * ```
 */
export class ErrorClassifier {
  /**
   * Classify an error into a retry category.
   *
   * Classification is based on:
   * 1. The error's `code` property (duck-typing, not instanceof)
   * 2. HTTP status codes if available
   * 3. Error message patterns
   *
   * @param error - The error to classify.
   * @returns A ClassifiedError with the classification and suggested retry delay.
   */
  classify(error: unknown): ClassifiedError {
    if (error instanceof Error) {
      // Check for HTTP status codes first
      const httpStatus = this.extractHttpStatus(error);
      if (httpStatus !== null) {
        return this.classifyByHttpStatus(httpStatus, error);
      }

      // Check for known error codes
      const errorCode = this.extractErrorCode(error);
      if (errorCode !== null) {
        return this.classifyByErrorCode(errorCode);
      }

      // Check error message patterns
      return this.classifyByMessage(error.message);
    }

    // Non-Error values default to UNKNOWN
    return { classification: ERROR_CLASSIFICATION.UNKNOWN, retryAfterMs: 5000 };
  }

  /**
   * Extract an HTTP status code from an error if available.
   *
   * Looks for common patterns: `status`, `statusCode`, or a
   * numeric code in the 400-599 range.
   */
  private extractHttpStatus(error: Error): number | null {
    const candidate = error as unknown as Record<string, unknown>;

    // Check for standard HTTP status properties
    if (typeof candidate.status === 'number') {
      return candidate.status;
    }
    if (typeof candidate.statusCode === 'number') {
      return candidate.statusCode;
    }

    return null;
  }

  /**
   * Extract an error code string from the error.
   *
   * Uses duck-typing (checks for a `code` property) rather than
   * instanceof, because ESM module deduplication breaks instanceof
   * across package boundaries.
   */
  private extractErrorCode(error: Error): string | null {
    const candidate = error as unknown as Record<string, unknown>;
    if (typeof candidate.code === 'string') {
      return candidate.code;
    }
    return null;
  }

  /**
   * Classify based on HTTP status code.
   */
  private classifyByHttpStatus(
    status: number,
    _error: Error,
  ): ClassifiedError {
    switch (status) {
      case 429:
        // Rate limited — respect Retry-After if available
        const retryAfter = this.extractRetryAfter(_error);
        return {
          classification: ERROR_CLASSIFICATION.RATE_LIMITED,
          retryAfterMs: retryAfter,
        };
      case 400:
        return {
          classification: ERROR_CLASSIFICATION.PERMANENT,
          retryAfterMs: 0,
        };
      case 401:
      case 403:
        return {
          classification: ERROR_CLASSIFICATION.AUTHENTICATION,
          retryAfterMs: 0,
        };
      case 404:
        return {
          classification: ERROR_CLASSIFICATION.PERMANENT,
          retryAfterMs: 0,
        };
      case 409:
        return {
          classification: ERROR_CLASSIFICATION.CONFLICT,
          retryAfterMs: 0,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          classification: ERROR_CLASSIFICATION.TRANSIENT,
          retryAfterMs: 1000,
        };
      default:
        // Unknown HTTP status
        if (status >= 400 && status < 500) {
          return {
            classification: ERROR_CLASSIFICATION.PERMANENT,
            retryAfterMs: 0,
          };
        }
        return {
          classification: ERROR_CLASSIFICATION.UNKNOWN,
          retryAfterMs: 5000,
        };
    }
  }

  /**
   * Classify based on a known error code string.
   */
  private classifyByErrorCode(code: string): ClassifiedError {
    switch (code) {
      case 'RATE_LIMITED':
      case 'TOO_MANY_REQUESTS':
        return {
          classification: ERROR_CLASSIFICATION.RATE_LIMITED,
          retryAfterMs: 1000,
        };
      case 'AUTHENTICATION_FAILED':
      case 'UNAUTHORIZED':
      case 'FORBIDDEN':
        return {
          classification: ERROR_CLASSIFICATION.AUTHENTICATION,
          retryAfterMs: 0,
        };
      case 'CONFLICT_RESOLUTION_FAILED':
      case 'CONFLICT':
      case 'REVISION_MISMATCH':
        return {
          classification: ERROR_CLASSIFICATION.CONFLICT,
          retryAfterMs: 0,
        };
      case 'CURSOR_TOO_OLD':
        // Not a mutation send error, but a sync protocol error
        return {
          classification: ERROR_CLASSIFICATION.PERMANENT,
          retryAfterMs: 0,
        };
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
      case 'ECONNREFUSED':
      case 'ECONNRESET':
      case 'ENOTFOUND':
      case 'ETIMEDOUT':
      case 'SOCKET_HANG_UP':
        return {
          classification: ERROR_CLASSIFICATION.TRANSIENT,
          retryAfterMs: 1000,
        };
      default:
        return {
          classification: ERROR_CLASSIFICATION.UNKNOWN,
          retryAfterMs: 5000,
        };
    }
  }

  /**
   * Classify based on error message patterns.
   * This is a fallback when no structured error data is available.
   */
  private classifyByMessage(message: string): ClassifiedError {
    const lowerMessage = message.toLowerCase();

    // Network-related patterns
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('econnreset') ||
      lowerMessage.includes('socket hang up') ||
      lowerMessage.includes('fetch failed')
    ) {
      return {
        classification: ERROR_CLASSIFICATION.TRANSIENT,
        retryAfterMs: 1000,
      };
    }

    // Rate limit patterns
    if (
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('throttl')
    ) {
      return {
        classification: ERROR_CLASSIFICATION.RATE_LIMITED,
        retryAfterMs: 1000,
      };
    }

    // Authentication patterns
    if (
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('authentication')
    ) {
      return {
        classification: ERROR_CLASSIFICATION.AUTHENTICATION,
        retryAfterMs: 0,
      };
    }

    // Conflict patterns
    if (
      lowerMessage.includes('conflict') ||
      lowerMessage.includes('revision mismatch')
    ) {
      return {
        classification: ERROR_CLASSIFICATION.CONFLICT,
        retryAfterMs: 0,
      };
    }

    // Default: UNKNOWN with conservative retry
    return {
      classification: ERROR_CLASSIFICATION.UNKNOWN,
      retryAfterMs: 5000,
    };
  }

  /**
   * Extract Retry-After header value from an error.
   *
   * @param error - The error that may contain retry-after information.
   * @returns Delay in milliseconds, or 1000 as default for rate limits.
   */
  private extractRetryAfter(error: Error): number {
    const candidate = error as unknown as Record<string, unknown>;
    if (typeof candidate.retryAfter === 'number') {
      return candidate.retryAfter * 1000;
    }
    if (typeof candidate.retryAfterMs === 'number') {
      return candidate.retryAfterMs;
    }
    // Default: 1 second for rate limits
    return 1000;
  }
}
