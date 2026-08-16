import { describe, it, expect } from 'vitest';
import { ServerChangeLog } from '../src/change-log.js';
import type { ProtocolEntity } from '@offlinesync/protocol';

function makeEntity(overrides?: Partial<ProtocolEntity>): ProtocolEntity {
  return {
    id: 'entity-001',
    data: { title: 'Test' },
    revision: 1,
    createdAt: '2026-08-14T10:00:00Z',
    updatedAt: '2026-08-14T10:00:00Z',
    isDeleted: false,
    ...overrides,
  };
}

describe('ServerChangeLog', () => {
  it('should assign monotonically increasing server sequences when appending entries', () => {
    const log = new ServerChangeLog();
    const entity = makeEntity();

    const seq1 = log.append({
      collectionName: 'tasks',
      entityId: 'entity-001',
      entity,
      operation: 'set',
      field: null,
      value: { title: 'Test' },
    });

    const seq2 = log.append({
      collectionName: 'tasks',
      entityId: 'entity-002',
      entity: makeEntity({ id: 'entity-002' }),
      operation: 'set',
      field: null,
      value: { title: 'Test 2' },
    });

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(log.size).toBe(2);
  });

  it('should return empty array when querying changes since the current cursor', () => {
    const log = new ServerChangeLog();
    const entity = makeEntity();

    log.append({
      collectionName: 'tasks',
      entityId: 'entity-001',
      entity,
      operation: 'set',
      field: null,
      value: { title: 'Test' },
    });

    const changes = log.getChangesSince(log.currentCursor);
    expect(changes).toHaveLength(0);
  });

  it('should return all entries when querying changes since cursor zero', () => {
    const log = new ServerChangeLog();
    const entity = makeEntity();

    log.append({
      collectionName: 'tasks',
      entityId: 'entity-001',
      entity,
      operation: 'set',
      field: null,
      value: { title: 'Test' },
    });

    log.append({
      collectionName: 'tasks',
      entityId: 'entity-002',
      entity: makeEntity({ id: 'entity-002' }),
      operation: 'set',
      field: null,
      value: { title: 'Test 2' },
    });

    const changes = log.getChangesSince('0');
    expect(changes).toHaveLength(2);
    expect(changes[0]?.serverSequence).toBe(1);
    expect(changes[1]?.serverSequence).toBe(2);
  });

  it('should return only entries after the given cursor', () => {
    const log = new ServerChangeLog();
    const entity = makeEntity();

    log.append({
      collectionName: 'tasks',
      entityId: 'entity-001',
      entity,
      operation: 'set',
      field: null,
      value: { title: 'Test' },
    });
    log.append({
      collectionName: 'tasks',
      entityId: 'entity-002',
      entity: makeEntity({ id: 'entity-002' }),
      operation: 'set',
      field: null,
      value: { title: 'Test 2' },
    });
    log.append({
      collectionName: 'tasks',
      entityId: 'entity-003',
      entity: makeEntity({ id: 'entity-003' }),
      operation: 'set',
      field: null,
      value: { title: 'Test 3' },
    });

    const changes = log.getChangesSince('1');
    expect(changes).toHaveLength(2);
    expect(changes[0]?.serverSequence).toBe(2);
    expect(changes[1]?.serverSequence).toBe(3);
  });

  it('should prune entries below minimumAvailableCursor when set', () => {
    const log = new ServerChangeLog();

    for (let i = 0; i < 5; i++) {
      log.append({
        collectionName: 'tasks',
        entityId: `entity-${String(i).padStart(3, '0')}`,
        entity: makeEntity({ id: `entity-${String(i).padStart(3, '0')}` }),
        operation: 'set',
        field: null,
        value: { title: `Test ${i}` },
      });
    }

    expect(log.size).toBe(5);

    log.setMinimumAvailableCursor('3');
    expect(log.size).toBe(3);
    expect(log.minimumAvailableCursor).toBe('3');
  });

  it('should detect when cursor is too old relative to minimumAvailableCursor', () => {
    const log = new ServerChangeLog();

    for (let i = 0; i < 5; i++) {
      log.append({
        collectionName: 'tasks',
        entityId: `entity-${String(i).padStart(3, '0')}`,
        entity: makeEntity({ id: `entity-${String(i).padStart(3, '0')}` }),
        operation: 'set',
        field: null,
        value: { title: `Test ${i}` },
      });
    }

    log.setMinimumAvailableCursor('3');

    expect(log.isCursorTooOld('1')).toBe(true);
    expect(log.isCursorTooOld('2')).toBe(true);
    expect(log.isCursorTooOld('3')).toBe(false);
    expect(log.isCursorTooOld('4')).toBe(false);
  });

  it('should start with current cursor as zero', () => {
    const log = new ServerChangeLog();
    expect(log.currentCursor).toBe('0');
  });
});
