/**
 * ServerChangeLog — append-only change log with global server sequences.
 *
 * Each entry records a mutation that was applied to the server.
 * The server sequence is a global log position, NOT an entity revision (INV-6).
 * Entries are ordered by serverSequence in ascending order.
 */

import type { ProtocolEntity } from '@offlinesync/protocol';

/**
 * A single entry in the server's change log.
 */
export interface ChangeLogEntry {
  /** Global server sequence number (log position) */
  readonly serverSequence: number;
  /** The collection this entity belongs to */
  readonly collectionName: string;
  /** The entity ID */
  readonly entityId: string;
  /** The entity state after this change was applied */
  readonly entity: ProtocolEntity;
  /** The operation that produced this change */
  readonly operation: string;
  /** The field modified (null for set/patch) */
  readonly field: string | null;
  /** The value of the operation */
  readonly value: unknown;
}

/**
 * Append-only change log with server sequences and cursor management.
 *
 * The log stores every mutation applied to the server.
 * The minimumAvailableCursor tracks the oldest cursor position
 * that clients can use for incremental sync.
 */
export class ServerChangeLog {
  private entries: ChangeLogEntry[] = [];
  private nextSequence = 1;
  private _minimumAvailableCursor = '0';

  /**
   * The oldest cursor value that clients can use for incremental sync.
   * Changes before this position have been pruned.
   */
  get minimumAvailableCursor(): string {
    return this._minimumAvailableCursor;
  }

  /**
   * The current cursor value representing the latest server log position.
   * A client that has seen all changes up to this position is fully synced.
   */
  get currentCursor(): string {
    return String(this.nextSequence - 1);
  }

  /** Number of entries currently in the log. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Append a new entry to the change log.
   *
   * @param entry - The entry to append (without serverSequence, which is assigned)
   * @returns The assigned server sequence number
   */
  append(
    entry: Omit<ChangeLogEntry, 'serverSequence'>,
  ): number {
    const serverSequence = this.nextSequence++;
    this.entries.push({ ...entry, serverSequence });
    return serverSequence;
  }

  /**
   * Get all changes after the given cursor.
   *
   * @param cursorValue - The client's cursor (server sequence as string)
   * @returns Array of entries after the cursor, ordered by serverSequence ascending
   */
  getChangesSince(cursorValue: string): ChangeLogEntry[] {
    const cursorSeq = Number(cursorValue);
    if (Number.isNaN(cursorSeq)) {
      return this.entries.slice();
    }
    return this.entries.filter((e) => e.serverSequence > cursorSeq);
  }

  /**
   * Check whether a given cursor is too old for incremental sync.
   *
   * @param cursorValue - The client's cursor
   * @returns true if the cursor is older than minimumAvailableCursor
   */
  isCursorTooOld(cursorValue: string): boolean {
    const cursorSeq = Number(cursorValue);
    const minSeq = Number(this._minimumAvailableCursor);
    if (Number.isNaN(cursorSeq) || Number.isNaN(minSeq)) {
      return false;
    }
    return cursorSeq < minSeq;
  }

  /**
   * Set the minimum available cursor and prune entries below it.
   *
   * Entries with serverSequence below the given value are removed.
   * The mutation tracker should also be pruned with the same value.
   *
   * @param cursorValue - The new minimum available cursor
   */
  setMinimumAvailableCursor(cursorValue: string): void {
    this._minimumAvailableCursor = cursorValue;
    const seq = Number(cursorValue);
    if (!Number.isNaN(seq)) {
      this.entries = this.entries.filter((e) => e.serverSequence >= seq);
    }
  }
}
