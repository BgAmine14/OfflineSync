/**
 * Tests for ErrorClassifier (INV-9).
 *
 * Verifies:
 * - HTTP status code classification
 * - Error code classification
 * - Error message pattern classification
 * - Default to UNKNOWN for unclassifiable errors
 * - Retry-After header extraction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorClassifier } from '../src/error-classifier.js';
import { ERROR_CLASSIFICATION } from '../src/types/index.js';

describe('ErrorClassifier', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
  });

  describe('HTTP status classification', () => {
    it('should classify 429 as RATE_LIMITED', () => {
      const error = new Error('Too Many Requests');
      (error as unknown as Record<string, unknown>).status = 429;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.RATE_LIMITED);
      expect(result.retryAfterMs).toBe(1000);
    });

    it('should classify 400 as PERMANENT', () => {
      const error = new Error('Bad Request');
      (error as unknown as Record<string, unknown>).status = 400;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.PERMANENT);
    });

    it('should classify 401 as AUTHENTICATION', () => {
      const error = new Error('Unauthorized');
      (error as unknown as Record<string, unknown>).status = 401;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.AUTHENTICATION);
    });

    it('should classify 403 as AUTHENTICATION', () => {
      const error = new Error('Forbidden');
      (error as unknown as Record<string, unknown>).status = 403;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.AUTHENTICATION);
    });

    it('should classify 404 as PERMANENT', () => {
      const error = new Error('Not Found');
      (error as unknown as Record<string, unknown>).status = 404;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.PERMANENT);
    });

    it('should classify 409 as CONFLICT', () => {
      const error = new Error('Conflict');
      (error as unknown as Record<string, unknown>).status = 409;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.CONFLICT);
    });

    it('should classify 500 as TRANSIENT', () => {
      const error = new Error('Internal Server Error');
      (error as unknown as Record<string, unknown>).status = 500;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify 502 as TRANSIENT', () => {
      const error = new Error('Bad Gateway');
      (error as unknown as Record<string, unknown>).status = 502;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify 503 as TRANSIENT', () => {
      const error = new Error('Service Unavailable');
      (error as unknown as Record<string, unknown>).status = 503;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify 504 as TRANSIENT', () => {
      const error = new Error('Gateway Timeout');
      (error as unknown as Record<string, unknown>).status = 504;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify 422 as PERMANENT', () => {
      const error = new Error('Unprocessable Entity');
      (error as unknown as Record<string, unknown>).status = 422;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.PERMANENT);
    });

    it('should use statusCode property if status is absent', () => {
      const error = new Error('Service Unavailable');
      (error as unknown as Record<string, unknown>).statusCode = 503;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should use Retry-After header for rate limits', () => {
      const error = new Error('Too Many Requests');
      (error as unknown as Record<string, unknown>).status = 429;
      (error as unknown as Record<string, unknown>).retryAfter = 5;

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.RATE_LIMITED);
      expect(result.retryAfterMs).toBe(5000);
    });
  });

  describe('Error code classification', () => {
    it('should classify RATE_LIMITED code', () => {
      const error = new Error('Rate limited');
      (error as unknown as Record<string, unknown>).code = 'RATE_LIMITED';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.RATE_LIMITED);
    });

    it('should classify AUTHENTICATION_FAILED code', () => {
      const error = new Error('Auth failed');
      (error as unknown as Record<string, unknown>).code = 'AUTHENTICATION_FAILED';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.AUTHENTICATION);
    });

    it('should classify CONFLICT code', () => {
      const error = new Error('Conflict');
      (error as unknown as Record<string, unknown>).code = 'CONFLICT';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.CONFLICT);
    });

    it('should classify NETWORK_ERROR code', () => {
      const error = new Error('Network failed');
      (error as unknown as Record<string, unknown>).code = 'NETWORK_ERROR';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify TIMEOUT code', () => {
      const error = new Error('Timed out');
      (error as unknown as Record<string, unknown>).code = 'TIMEOUT';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify ECONNREFUSED code', () => {
      const error = new Error('Connection refused');
      (error as unknown as Record<string, unknown>).code = 'ECONNREFUSED';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });
  });

  describe('Message pattern classification', () => {
    it('should classify network error messages as TRANSIENT', () => {
      const error = new Error('network request failed');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify timeout messages as TRANSIENT', () => {
      const error = new Error('Request timeout after 30000ms');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });

    it('should classify rate limit messages as RATE_LIMITED', () => {
      const error = new Error('Rate limit exceeded for this endpoint');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.RATE_LIMITED);
    });

    it('should classify unauthorized messages as AUTHENTICATION', () => {
      const error = new Error('Authentication token expired');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.AUTHENTICATION);
    });

    it('should classify conflict messages as CONFLICT', () => {
      const error = new Error('Revision mismatch detected');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.CONFLICT);
    });

    it('should classify fetch failed messages as TRANSIENT', () => {
      const error = new Error('fetch failed');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });
  });

  describe('Default behavior (INV-9)', () => {
    it('should default non-Error values to UNKNOWN', () => {
      const result = classifier.classify('string error');

      expect(result.classification).toBe(ERROR_CLASSIFICATION.UNKNOWN);
      expect(result.retryAfterMs).toBe(5000);
    });

    it('should default unknown Error to UNKNOWN', () => {
      const error = new Error('Something unexpected happened');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.UNKNOWN);
      expect(result.retryAfterMs).toBe(5000);
    });

    it('should default to UNKNOWN when error has no code or status', () => {
      const error = new Error('weird error');

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.UNKNOWN);
    });
  });

  describe('Priority', () => {
    it('should prioritize HTTP status over error code', () => {
      const error = new Error('Conflict');
      (error as unknown as Record<string, unknown>).status = 500;
      (error as unknown as Record<string, unknown>).code = 'CONFLICT';

      const result = classifier.classify(error);
      expect(result.classification).toBe(ERROR_CLASSIFICATION.TRANSIENT);
    });
  });
});
