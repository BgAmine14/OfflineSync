/**
 * @offlinesync/discovery
 *
 * Typed error for discovery-related failures.
 */

/**
 * Error thrown when a discovery operation fails.
 */
export class DiscoveryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DiscoveryError';
  }
}
