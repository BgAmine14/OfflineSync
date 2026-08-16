import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ServerMutationTracker } from '../src/mutation-tracker.js';

describe('ServerMutationTracker', () => {
  it('should report not seen when mutation ID has not been recorded', () => {
    const tracker = new ServerMutationTracker();
    expect(tracker.has('mut-001')).toBe(false);
  });

  it('should report seen after recording a mutation ID', () => {
    const tracker = new ServerMutationTracker();
    tracker.record('mut-001', 1);
    expect(tracker.has('mut-001')).toBe(true);
    expect(tracker.size).toBe(1);
  });

  it('should not increase size when recording the same mutation ID twice', () => {
    const tracker = new ServerMutationTracker();
    tracker.record('mut-001', 1);
    tracker.record('mut-001', 2);
    expect(tracker.size).toBe(1);
  });

  it('should prune mutation IDs below the given sequence', () => {
    const tracker = new ServerMutationTracker();
    tracker.record('mut-001', 1);
    tracker.record('mut-002', 2);
    tracker.record('mut-003', 5);
    tracker.record('mut-004', 10);

    const pruned = tracker.pruneBelowSequence(3);

    expect(pruned).toBe(2);
    expect(tracker.size).toBe(2);
    expect(tracker.has('mut-001')).toBe(false);
    expect(tracker.has('mut-002')).toBe(false);
    expect(tracker.has('mut-003')).toBe(true);
    expect(tracker.has('mut-004')).toBe(true);
  });

  it('should return zero pruned count when nothing is below the threshold', () => {
    const tracker = new ServerMutationTracker();
    tracker.record('mut-001', 5);
    tracker.record('mut-002', 10);

    const pruned = tracker.pruneBelowSequence(3);
    expect(pruned).toBe(0);
    expect(tracker.size).toBe(2);
  });

  it('should correctly deduplicate mutations (PBT: idempotency property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1 }),
            fc.nat(),
          ),
          { maxLength: 100 },
        ),
        (entries) => {
          const tracker = new ServerMutationTracker();

          // Record all entries
          for (const [id, seq] of entries) {
            tracker.record(id, seq);
          }

          // After recording, every unique ID should be reported as seen
          const uniqueIds = new Set(entries.map(([id]) => id));
          expect(tracker.size).toBe(uniqueIds.size);

          for (const id of uniqueIds) {
            expect(tracker.has(id)).toBe(true);
          }

          // Re-recording should not change the size
          const sizeBefore = tracker.size;
          for (const [id, seq] of entries) {
            tracker.record(id, seq);
          }
          expect(tracker.size).toBe(sizeBefore);
        },
      ),
    );
  });

  it('should prune correct number of entries after interleaved recording (PBT)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1 }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { maxLength: 200 },
        ),
        fc.integer({ min: 0, max: 1000 }),
        (entries, threshold) => {
          const tracker = new ServerMutationTracker();

          for (const [id, seq] of entries) {
            tracker.record(id, seq);
          }

          const pruned = tracker.pruneBelowSequence(threshold);

          // Count unique IDs with sequence < threshold
          const uniqueBelowThreshold = new Set(
            entries.filter(([_id, seq]) => seq < threshold).map(([id]) => id),
          );
          expect(pruned).toBe(uniqueBelowThreshold.size);
          // All remaining tracked mutations should have seq >= threshold
          // (verified indirectly by the pruned count being correct)
        },
      ),
    );
  });
});
