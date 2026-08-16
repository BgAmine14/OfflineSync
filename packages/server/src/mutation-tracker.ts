/**
 * ServerMutationTracker — deduplication tracker for server-side mutations (INV-5).
 *
 * Tracks mutation IDs that have been applied to the server.
 * Ensures the same mutation ID applied twice has the same effect as applied once.
 */

/**
 * Mutation tracker for server-side deduplication.
 *
 * Each mutation ID is recorded along with the server sequence at which
 * it was applied, enabling pruning of old entries when the change log
 * is trimmed.
 */
export class ServerMutationTracker {
  private readonly mutations = new Map<string, number>();

  /** Number of tracked mutation IDs. */
  get size(): number {
    return this.mutations.size;
  }

  /**
   * Check whether a mutation ID has already been recorded.
   *
   * @param mutationId - The mutation ID to check
   * @returns true if the mutation has been seen before
   */
  has(mutationId: string): boolean {
    return this.mutations.has(mutationId);
  }

  /**
   * Record a mutation ID with its associated server sequence.
   *
   * @param mutationId - The mutation ID to record
   * @param serverSequence - The server sequence at which it was applied
   */
  record(mutationId: string, serverSequence: number): void {
    this.mutations.set(mutationId, serverSequence);
  }

  /**
   * Prune mutation IDs that were applied before the given server sequence.
   *
   * Called when the change log's minimumAvailableCursor is advanced.
   * Mutations older than the minimum available cursor no longer need
   * to be tracked because clients with those cursors must do a full snapshot sync.
   *
   * @param minSequence - Mutations with serverSequence below this are pruned
   * @returns The number of mutation IDs that were pruned
   */
  pruneBelowSequence(minSequence: number): number {
    let pruned = 0;
    for (const [id, seq] of this.mutations) {
      if (seq < minSequence) {
        this.mutations.delete(id);
        pruned++;
      }
    }
    return pruned;
  }
}
