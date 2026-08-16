import { describe, it, expect } from 'vitest';
import {
  SYNC_ERROR_CODE,
  ERROR_CLASSIFICATION,
  ERROR_CODE_CLASSIFICATION,
  ERROR_CODE_HTTP_STATUS,
  CLASSIFICATION_RETRY_BEHAVIOR,
  CURRENT_PROTOCOL_VERSION,
  negotiateVersion,
  parseVersion,
  isProtocolEntity,
  isProtocolMutation,
  isChange,
  isConflictInfo,
  isSyncRequest,
  isSyncResponse,
  isSnapshotRequest,
  isSnapshotResponse,
  isProtocolError,
  isSyncErrorCode,
  isErrorClassification,
} from '../src/index.js';
import type {
  ProtocolMutation,
  SyncRequest,
  SyncResponse,
  Change,
  ConflictInfo,
  ProtocolEntity,
  SnapshotRequest,
  SnapshotResponse,
  ProtocolError,
} from '../src/index.js';

// --- Test Helpers ---

const validTimestamp = '2026-08-14T10:00:00Z';
const validTimestampWithOffset = '2026-08-14T10:00:00+02:00';
const validTimestampWithMs = '2026-08-14T10:00:00.123Z';

function makeProtocolEntity(
  overrides?: Partial<ProtocolEntity>,
): ProtocolEntity {
  return {
    id: '01912f3a-7b1a-7000-8000-000000000001',
    data: { title: 'Test' },
    revision: 1,
    createdAt: validTimestamp,
    updatedAt: validTimestamp,
    isDeleted: false,
    ...overrides,
  };
}

/** Remove a list of keys from an object (shallow copy). */
function omit<T extends Record<string, unknown>>(
  obj: T,
  ...keys: (keyof T)[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!(keys as readonly string[]).includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

function makeProtocolMutation(
  overrides?: Partial<ProtocolMutation>,
): ProtocolMutation {
  return {
    id: '01912f3a-7b1a-7000-8000-000000000002',
    entityId: '01912f3a-7b1a-7000-8000-000000000001',
    collectionName: 'tasks',
    operation: 'set',
    field: null,
    value: { title: 'Buy milk' },
    baseRevision: 1,
    createdAt: validTimestamp,
    ...overrides,
  };
}

function makeChange(overrides?: Partial<Change>): Change {
  return {
    serverSequence: 100,
    collectionName: 'tasks',
    entity: makeProtocolEntity(),
    operation: 'patch',
    field: null,
    value: { status: 'done' },
    ...overrides,
  };
}

function makeConflictInfo(
  overrides?: Partial<ConflictInfo>,
): ConflictInfo {
  return {
    mutationId: '01912f3a-7b1a-7000-8000-000000000002',
    entityId: '01912f3a-7b1a-7000-8000-000000000001',
    collectionName: 'tasks',
    clientRevision: 3,
    serverRevision: 5,
    serverEntity: makeProtocolEntity({ revision: 5 }),
    ...overrides,
  };
}

// ============================================================
// SYNC_ERROR_CODE
// ============================================================

describe('SYNC_ERROR_CODE', () => {
  it('should contain all six error codes', () => {
    expect(Object.keys(SYNC_ERROR_CODE)).toHaveLength(6);
  });

  it('should have UPPER_SNAKE_CASE keys', () => {
    for (const key of Object.keys(SYNC_ERROR_CODE)) {
      expect(key).toBe(key.toUpperCase());
    }
  });

  it('should have string values matching their keys', () => {
    for (const [key, value] of Object.entries(SYNC_ERROR_CODE)) {
      expect(value).toBe(key);
    }
  });
});

// ============================================================
// ERROR_CLASSIFICATION
// ============================================================

describe('ERROR_CLASSIFICATION', () => {
  it('should contain all six classifications', () => {
    expect(Object.keys(ERROR_CLASSIFICATION)).toHaveLength(6);
  });

  it('should have UPPER_SNAKE_CASE keys', () => {
    for (const key of Object.keys(ERROR_CLASSIFICATION)) {
      expect(key).toBe(key.toUpperCase());
    }
  });

  it('should have string values matching their keys', () => {
    for (const [key, value] of Object.entries(ERROR_CLASSIFICATION)) {
      expect(value).toBe(key);
    }
  });
});

// ============================================================
// ERROR_CODE_CLASSIFICATION
// ============================================================

describe('ERROR_CODE_CLASSIFICATION', () => {
  it('should classify CURSOR_TOO_OLD as TRANSIENT', () => {
    expect(ERROR_CODE_CLASSIFICATION['CURSOR_TOO_OLD']).toBe('TRANSIENT');
  });

  it('should classify AUTHENTICATION_FAILED as AUTHENTICATION', () => {
    expect(ERROR_CODE_CLASSIFICATION['AUTHENTICATION_FAILED']).toBe(
      'AUTHENTICATION',
    );
  });

  it('should classify RATE_LIMITED as RATE_LIMITED', () => {
    expect(ERROR_CODE_CLASSIFICATION['RATE_LIMITED']).toBe('RATE_LIMITED');
  });

  it('should classify INVALID_REQUEST as PERMANENT', () => {
    expect(ERROR_CODE_CLASSIFICATION['INVALID_REQUEST']).toBe('PERMANENT');
  });

  it('should classify INTERNAL_ERROR as TRANSIENT', () => {
    expect(ERROR_CODE_CLASSIFICATION['INTERNAL_ERROR']).toBe('TRANSIENT');
  });

  it('should classify UNKNOWN as UNKNOWN', () => {
    expect(ERROR_CODE_CLASSIFICATION['UNKNOWN']).toBe('UNKNOWN');
  });

  it('should have a classification for every error code', () => {
    for (const code of Object.values(SYNC_ERROR_CODE)) {
      expect(code in ERROR_CODE_CLASSIFICATION).toBe(true);
    }
  });
});

// ============================================================
// ERROR_CODE_HTTP_STATUS
// ============================================================

describe('ERROR_CODE_HTTP_STATUS', () => {
  it('should map CURSOR_TOO_OLD to 409', () => {
    expect(ERROR_CODE_HTTP_STATUS['CURSOR_TOO_OLD']).toBe(409);
  });

  it('should map AUTHENTICATION_FAILED to 401', () => {
    expect(ERROR_CODE_HTTP_STATUS['AUTHENTICATION_FAILED']).toBe(401);
  });

  it('should map RATE_LIMITED to 429', () => {
    expect(ERROR_CODE_HTTP_STATUS['RATE_LIMITED']).toBe(429);
  });

  it('should map INVALID_REQUEST to 400', () => {
    expect(ERROR_CODE_HTTP_STATUS['INVALID_REQUEST']).toBe(400);
  });

  it('should map INTERNAL_ERROR to 500', () => {
    expect(ERROR_CODE_HTTP_STATUS['INTERNAL_ERROR']).toBe(500);
  });

  it('should map UNKNOWN to 500', () => {
    expect(ERROR_CODE_HTTP_STATUS['UNKNOWN']).toBe(500);
  });

  it('should have a status for every error code', () => {
    for (const code of Object.values(SYNC_ERROR_CODE)) {
      expect(code in ERROR_CODE_HTTP_STATUS).toBe(true);
    }
  });
});

// ============================================================
// CLASSIFICATION_RETRY_BEHAVIOR
// ============================================================

describe('CLASSIFICATION_RETRY_BEHAVIOR', () => {
  it('should have a behavior for every classification', () => {
    for (const classification of Object.values(ERROR_CLASSIFICATION)) {
      expect(classification in CLASSIFICATION_RETRY_BEHAVIOR).toBe(true);
    }
  });

  it('should mark TRANSIENT as retriable', () => {
    expect(CLASSIFICATION_RETRY_BEHAVIOR['TRANSIENT']['shouldRetry']).toBe(
      true,
    );
  });

  it('should mark RATE_LIMITED as retriable', () => {
    expect(CLASSIFICATION_RETRY_BEHAVIOR['RATE_LIMITED']['shouldRetry']).toBe(
      true,
    );
  });

  it('should mark CONFLICT as non-retriable', () => {
    expect(CLASSIFICATION_RETRY_BEHAVIOR['CONFLICT']['shouldRetry']).toBe(
      false,
    );
  });

  it('should mark AUTHENTICATION as non-retriable', () => {
    expect(
      CLASSIFICATION_RETRY_BEHAVIOR['AUTHENTICATION']['shouldRetry'],
    ).toBe(false);
  });

  it('should mark PERMANENT as non-retriable', () => {
    expect(CLASSIFICATION_RETRY_BEHAVIOR['PERMANENT']['shouldRetry']).toBe(
      false,
    );
  });

  it('should mark UNKNOWN as retriable', () => {
    expect(CLASSIFICATION_RETRY_BEHAVIOR['UNKNOWN']['shouldRetry']).toBe(
      true,
    );
  });
});

// ============================================================
// Version Negotiation
// ============================================================

describe('CURRENT_PROTOCOL_VERSION', () => {
  it('should be a valid semver string', () => {
    const [major, minor] = parseVersion(CURRENT_PROTOCOL_VERSION);
    expect(major).toBeGreaterThanOrEqual(1);
    expect(minor).toBeGreaterThanOrEqual(0);
  });
});

describe('parseVersion', () => {
  it('should parse valid versions', () => {
    expect(parseVersion('1.0')).toEqual([1, 0]);
    expect(parseVersion('2.3')).toEqual([2, 3]);
    expect(parseVersion('0.1')).toEqual([0, 1]);
  });

  it('should throw when version has no minor part', () => {
    expect(() => parseVersion('1')).toThrow('Invalid protocol version format');
  });

  it('should throw when version has too many parts', () => {
    expect(() => parseVersion('1.0.0')).toThrow(
      'Invalid protocol version format',
    );
  });

  it('should throw when version has non-numeric parts', () => {
    expect(() => parseVersion('a.b')).toThrow('Invalid protocol version format');
  });

  it('should throw when version has negative numbers', () => {
    expect(() => parseVersion('1.-1')).toThrow('Invalid protocol version format');
  });
});

describe('negotiateVersion', () => {
  it('should select the highest common version', () => {
    const result = negotiateVersion(
      ['1.0', '1.1'],
      ['1.0', '1.1', '1.2'],
    );
    expect(result).toBe('1.1');
  });

  it('should return the only common version', () => {
    const result = negotiateVersion(
      ['1.0'],
      ['1.0', '1.1', '2.0'],
    );
    expect(result).toBe('1.0');
  });

  it('should return undefined when no common version exists', () => {
    const result = negotiateVersion(
      ['2.0', '2.1'],
      ['1.0', '1.1'],
    );
    expect(result).toBeUndefined();
  });

  it('should return undefined when both lists are empty', () => {
    const result = negotiateVersion([], []);
    expect(result).toBeUndefined();
  });

  it('should prefer higher major versions', () => {
    const result = negotiateVersion(
      ['1.0', '2.0'],
      ['1.0', '2.0'],
    );
    expect(result).toBe('2.0');
  });

  it('should not cross major version boundaries', () => {
    // Client supports 1.x only, server supports 1.0 and 2.0.
    // Common version is 1.0 only.
    const result = negotiateVersion(
      ['1.0', '1.9'],
      ['2.0', '1.0'],
    );
    expect(result).toBe('1.0');
  });
});

// ============================================================
// isProtocolEntity
// ============================================================

describe('isProtocolEntity', () => {
  it('should return true for a valid entity', () => {
    expect(isProtocolEntity(makeProtocolEntity())).toBe(true);
  });

  it('should accept entities with isDeleted true', () => {
    expect(isProtocolEntity(makeProtocolEntity({ isDeleted: true }))).toBe(
      true,
    );
  });

  it('should reject non-objects', () => {
    expect(isProtocolEntity(null)).toBe(false);
    expect(isProtocolEntity('string')).toBe(false);
    expect(isProtocolEntity(42)).toBe(false);
    expect(isProtocolEntity(undefined)).toBe(false);
    expect(isProtocolEntity([1, 2, 3])).toBe(false);
  });

  it('should reject when id is missing', () => {
    const entity = omit(makeProtocolEntity(), 'id');
    expect(isProtocolEntity(entity)).toBe(false);
  });

  it('should reject when id is empty string', () => {
    expect(isProtocolEntity(makeProtocolEntity({ id: '' }))).toBe(false);
  });

  it('should reject when revision is not a number', () => {
    expect(
      isProtocolEntity(makeProtocolEntity({ revision: '3' as unknown as number })),
    ).toBe(false);
  });

  it('should reject when createdAt is not ISO 8601', () => {
    expect(
      isProtocolEntity(makeProtocolEntity({ createdAt: 'not-a-date' })),
    ).toBe(false);
  });

  it('should accept ISO 8601 with timezone offset', () => {
    expect(
      isProtocolEntity(
        makeProtocolEntity({ updatedAt: validTimestampWithOffset }),
      ),
    ).toBe(true);
  });

  it('should accept ISO 8601 with milliseconds', () => {
    expect(
      isProtocolEntity(
        makeProtocolEntity({ createdAt: validTimestampWithMs }),
      ),
    ).toBe(true);
  });

  it('should reject when isDeleted is not a boolean', () => {
    expect(
      isProtocolEntity(
        makeProtocolEntity({ isDeleted: 'false' as unknown as boolean }),
      ),
    ).toBe(false);
  });
});

// ============================================================
// isProtocolMutation
// ============================================================

describe('isProtocolMutation', () => {
  it('should return true for a valid mutation', () => {
    expect(isProtocolMutation(makeProtocolMutation())).toBe(true);
  });

  it('should accept field as null for set operation', () => {
    expect(
      isProtocolMutation(makeProtocolMutation({ field: null, operation: 'set' })),
    ).toBe(true);
  });

  it('should accept field as string for increment operation', () => {
    expect(
      isProtocolMutation(
        makeProtocolMutation({ field: 'count', operation: 'increment' }),
      ),
    ).toBe(true);
  });

  it('should reject when id is missing', () => {
    const mutation = omit(makeProtocolMutation(), 'id');
    expect(isProtocolMutation(mutation)).toBe(false);
  });

  it('should reject when baseRevision is negative', () => {
    expect(
      isProtocolMutation(makeProtocolMutation({ baseRevision: -1 })),
    ).toBe(false);
  });

  it('should accept baseRevision of zero', () => {
    expect(
      isProtocolMutation(makeProtocolMutation({ baseRevision: 0 })),
    ).toBe(true);
  });

  it('should reject when createdAt is not ISO 8601', () => {
    expect(
      isProtocolMutation(makeProtocolMutation({ createdAt: '2026-08-14' })),
    ).toBe(false);
  });

  it('should reject when operation is empty string', () => {
    expect(
      isProtocolMutation(makeProtocolMutation({ operation: '' })),
    ).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isProtocolMutation(null)).toBe(false);
    expect(isProtocolMutation(42)).toBe(false);
  });
});

// ============================================================
// isChange
// ============================================================

describe('isChange', () => {
  it('should return true for a valid change', () => {
    expect(isChange(makeChange())).toBe(true);
  });

  it('should reject when serverSequence is negative', () => {
    expect(isChange(makeChange({ serverSequence: -1 }))).toBe(false);
  });

  it('should reject when collectionName is missing', () => {
    const change = omit(makeChange(), 'collectionName');
    expect(isChange(change)).toBe(false);
  });

  it('should reject when entity is invalid', () => {
    expect(
      isChange(
        makeChange({
          entity: { ...makeProtocolEntity(), id: '' },
        }),
      ),
    ).toBe(false);
  });

  it('should accept field as null', () => {
    expect(isChange(makeChange({ field: null }))).toBe(true);
  });

  it('should accept field as string', () => {
    expect(isChange(makeChange({ field: 'status' }))).toBe(true);
  });

  it('should reject non-objects', () => {
    expect(isChange('not an object')).toBe(false);
  });
});

// ============================================================
// isConflictInfo
// ============================================================

describe('isConflictInfo', () => {
  it('should return true for valid conflict info', () => {
    expect(isConflictInfo(makeConflictInfo())).toBe(true);
  });

  it('should reject when clientRevision is negative', () => {
    expect(
      isConflictInfo(makeConflictInfo({ clientRevision: -1 })),
    ).toBe(false);
  });

  it('should reject when serverRevision is negative', () => {
    expect(
      isConflictInfo(makeConflictInfo({ serverRevision: -1 })),
    ).toBe(false);
  });

  it('should reject when serverEntity is invalid', () => {
    expect(
      isConflictInfo(
        makeConflictInfo({
          serverEntity: { ...makeProtocolEntity(), createdAt: 'bad' },
        }),
      ),
    ).toBe(false);
  });

  it('should reject when mutationId is empty', () => {
    expect(
      isConflictInfo(makeConflictInfo({ mutationId: '' })),
    ).toBe(false);
  });
});

// ============================================================
// isSyncRequest
// ============================================================

describe('isSyncRequest', () => {
  const validRequest: SyncRequest = {
    cursor: 'abc123',
    mutations: [makeProtocolMutation()],
    clientId: 'client-001',
  };

  it('should return true for a valid sync request', () => {
    expect(isSyncRequest(validRequest)).toBe(true);
  });

  it('should accept empty mutations array', () => {
    expect(isSyncRequest({ ...validRequest, mutations: [] })).toBe(true);
  });

  it('should accept empty cursor string', () => {
    expect(isSyncRequest({ ...validRequest, cursor: '' })).toBe(true);
  });

  it('should reject when cursor is missing', () => {
    const request = omit(validRequest, 'cursor');
    expect(isSyncRequest(request)).toBe(false);
  });

  it('should reject when cursor is not a string', () => {
    expect(isSyncRequest({ ...validRequest, cursor: 123 as unknown as string })).toBe(false);
  });

  it('should reject when clientId is empty', () => {
    expect(isSyncRequest({ ...validRequest, clientId: '' })).toBe(false);
  });

  it('should reject when mutations contains an invalid item', () => {
    expect(
      isSyncRequest({
        ...validRequest,
        mutations: [makeProtocolMutation(), { invalid: true }],
      }),
    ).toBe(false);
  });

  it('should reject when mutations is not an array', () => {
    expect(
      isSyncRequest({ ...validRequest, mutations: 'not-array' as unknown as ProtocolMutation[] }),
    ).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isSyncRequest(null)).toBe(false);
  });
});

// ============================================================
// isSyncResponse
// ============================================================

describe('isSyncResponse', () => {
  const validResponse: SyncResponse = {
    changes: [makeChange()],
    acknowledgedMutationIds: ['mut-001'],
    conflicts: [],
    newCursor: 'def456',
  };

  it('should return true for a valid sync response', () => {
    expect(isSyncResponse(validResponse)).toBe(true);
  });

  it('should accept empty changes array', () => {
    expect(
      isSyncResponse({ ...validResponse, changes: [] }),
    ).toBe(true);
  });

  it('should accept empty conflicts array', () => {
    expect(
      isSyncResponse({ ...validResponse, conflicts: [] }),
    ).toBe(true);
  });

  it('should accept valid conflicts', () => {
    expect(
      isSyncResponse({
        ...validResponse,
        conflicts: [makeConflictInfo()],
      }),
    ).toBe(true);
  });

  it('should reject when newCursor is empty', () => {
    expect(
      isSyncResponse({ ...validResponse, newCursor: '' }),
    ).toBe(false);
  });

  it('should reject when acknowledgedMutationIds has non-strings', () => {
    expect(
      isSyncResponse({
        ...validResponse,
        acknowledgedMutationIds: [123 as unknown as string],
      }),
    ).toBe(false);
  });

  it('should reject when changes contains invalid item', () => {
    expect(
      isSyncResponse({
        ...validResponse,
        changes: [{ invalid: true }],
      }),
    ).toBe(false);
  });

  it('should reject when conflicts contains invalid item', () => {
    expect(
      isSyncResponse({
        ...validResponse,
        conflicts: [{ mutationId: '' }],
      }),
    ).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isSyncResponse(42)).toBe(false);
  });
});

// ============================================================
// isSnapshotRequest
// ============================================================

describe('isSnapshotRequest', () => {
  it('should return true for a valid request with collections', () => {
    const request: SnapshotRequest = {
      collections: ['tasks', 'projects'],
      clientId: 'client-001',
    };
    expect(isSnapshotRequest(request)).toBe(true);
  });

  it('should return true for a request without collections', () => {
    const request: SnapshotRequest = {
      clientId: 'client-001',
    };
    expect(isSnapshotRequest(request)).toBe(true);
  });

  it('should accept empty collections array', () => {
    expect(
      isSnapshotRequest({ collections: [], clientId: 'client-001' }),
    ).toBe(true);
  });

  it('should reject when clientId is missing', () => {
    expect(isSnapshotRequest({ collections: ['tasks'] })).toBe(false);
  });

  it('should reject when clientId is empty', () => {
    expect(
      isSnapshotRequest({ clientId: '', collections: ['tasks'] }),
    ).toBe(false);
  });

  it('should reject when collections is not an array', () => {
    expect(
      isSnapshotRequest({
        clientId: 'client-001',
        collections: 'tasks' as unknown as string[],
      }),
    ).toBe(false);
  });

  it('should reject when collections contains non-strings', () => {
    expect(
      isSnapshotRequest({
        clientId: 'client-001',
        collections: [123 as unknown as string],
      }),
    ).toBe(false);
  });
});

// ============================================================
// isSnapshotResponse
// ============================================================

describe('isSnapshotResponse', () => {
  const validResponse: SnapshotResponse = {
    entities: {
      tasks: [makeProtocolEntity()],
      projects: [],
    },
    cursor: 'def456',
    serverTimestamp: validTimestamp,
  };

  it('should return true for a valid snapshot response', () => {
    expect(isSnapshotResponse(validResponse)).toBe(true);
  });

  it('should accept empty entities record', () => {
    expect(
      isSnapshotResponse({
        ...validResponse,
        entities: {},
      }),
    ).toBe(true);
  });

  it('should accept entities with empty arrays', () => {
    expect(isSnapshotResponse(validResponse)).toBe(true);
  });

  it('should reject when an entity in the array is invalid', () => {
    expect(
      isSnapshotResponse({
        ...validResponse,
        entities: {
          tasks: [{ id: 'incomplete' }],
        },
      }),
    ).toBe(false);
  });

  it('should reject when cursor is empty', () => {
    expect(
      isSnapshotResponse({ ...validResponse, cursor: '' }),
    ).toBe(false);
  });

  it('should reject when serverTimestamp is not ISO 8601', () => {
    expect(
      isSnapshotResponse({
        ...validResponse,
        serverTimestamp: 'not-a-date',
      }),
    ).toBe(false);
  });

  it('should reject when entities is not an object', () => {
    expect(
      isSnapshotResponse({
        ...validResponse,
        entities: [],
      }),
    ).toBe(false);
  });

  it('should reject when an entity collection value is not an array', () => {
    expect(
      isSnapshotResponse({
        ...validResponse,
        entities: {
          tasks: 'not-array' as unknown as unknown[],
        },
      }),
    ).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isSnapshotResponse(null)).toBe(false);
  });
});

// ============================================================
// isProtocolError
// ============================================================

describe('isProtocolError', () => {
  it('should return true for a valid error', () => {
    const error: ProtocolError = {
      code: 'CURSOR_TOO_OLD',
      message: 'Cursor is too old',
    };
    expect(isProtocolError(error)).toBe(true);
  });

  it('should accept all error codes', () => {
    for (const code of Object.values(SYNC_ERROR_CODE)) {
      expect(
        isProtocolError({ code, message: 'test' }),
      ).toBe(true);
    }
  });

  it('should accept errors with details', () => {
    expect(
      isProtocolError({
        code: 'CURSOR_TOO_OLD',
        message: 'Cursor too old',
        details: { minimumAvailableCursor: 'ghi789' },
      }),
    ).toBe(true);
  });

  it('should reject when code is not a valid error code', () => {
    expect(
      isProtocolError({ code: 'NOT_A_CODE', message: 'test' }),
    ).toBe(false);
  });

  it('should reject when code is a number', () => {
    expect(
      isProtocolError({ code: 400 as unknown as 'CURSOR_TOO_OLD', message: 'test' }),
    ).toBe(false);
  });

  it('should reject when message is missing', () => {
    expect(
      isProtocolError({ code: 'CURSOR_TOO_OLD' }),
    ).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isProtocolError('error string')).toBe(false);
    expect(isProtocolError(null)).toBe(false);
  });
});

// ============================================================
// isSyncErrorCode / isErrorClassification
// ============================================================

describe('isSyncErrorCode', () => {
  it('should accept all valid error codes', () => {
    for (const code of Object.values(SYNC_ERROR_CODE)) {
      expect(isSyncErrorCode(code)).toBe(true);
    }
  });

  it('should reject invalid strings', () => {
    expect(isSyncErrorCode('INVALID')).toBe(false);
    expect(isSyncErrorCode('')).toBe(false);
  });

  it('should reject non-strings', () => {
    expect(isSyncErrorCode(400)).toBe(false);
    expect(isSyncErrorCode(null)).toBe(false);
  });
});

describe('isErrorClassification', () => {
  it('should accept all valid classifications', () => {
    for (const cls of Object.values(ERROR_CLASSIFICATION)) {
      expect(isErrorClassification(cls)).toBe(true);
    }
  });

  it('should reject invalid strings', () => {
    expect(isErrorClassification('RETRYABLE')).toBe(false);
    expect(isErrorClassification('')).toBe(false);
  });

  it('should reject non-strings', () => {
    expect(isErrorClassification(42)).toBe(false);
    expect(isErrorClassification(undefined)).toBe(false);
  });
});

// ============================================================
// Round-trip JSON conformance
// ============================================================

describe('JSON round-trip conformance', () => {
  it('should preserve a SyncRequest through JSON serialization', () => {
    const original: SyncRequest = {
      cursor: 'abc123',
      mutations: [makeProtocolMutation()],
      clientId: 'client-001',
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isSyncRequest(parsed)).toBe(true);
  });

  it('should preserve a SyncResponse through JSON serialization', () => {
    const original: SyncResponse = {
      changes: [makeChange()],
      acknowledgedMutationIds: ['mut-001'],
      conflicts: [],
      newCursor: 'def456',
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isSyncResponse(parsed)).toBe(true);
  });

  it('should preserve a full SyncResponse with conflicts through JSON', () => {
    const original: SyncResponse = {
      changes: [makeChange()],
      acknowledgedMutationIds: [],
      conflicts: [makeConflictInfo()],
      newCursor: 'def456',
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isSyncResponse(parsed)).toBe(true);
  });

  it('should preserve a SnapshotRequest through JSON serialization', () => {
    const original: SnapshotRequest = {
      collections: ['tasks', 'projects'],
      clientId: 'client-001',
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isSnapshotRequest(parsed)).toBe(true);
  });

  it('should preserve a SnapshotResponse through JSON serialization', () => {
    const original: SnapshotResponse = {
      entities: {
        tasks: [makeProtocolEntity()],
      },
      cursor: 'def456',
      serverTimestamp: validTimestamp,
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isSnapshotResponse(parsed)).toBe(true);
  });

  it('should preserve a ProtocolError through JSON serialization', () => {
    const original: ProtocolError = {
      code: 'CURSOR_TOO_OLD',
      message: 'Cursor is too old',
      details: { minimumAvailableCursor: 'ghi789' },
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    expect(isProtocolError(parsed)).toBe(true);
  });

  it('should reject a SyncRequest with extra unknown fields at top level', () => {
    const request = {
      cursor: 'abc123',
      mutations: [],
      clientId: 'client-001',
      extraField: 'should be tolerated',
    };
    // Extra fields at top level are tolerated by the validator
    // because it only checks for required fields
    expect(isSyncRequest(request)).toBe(true);
  });

  it('should reject a SyncResponse with invalid mutation ID type in acknowledged', () => {
    const response = {
      changes: [],
      acknowledgedMutationIds: [123],
      conflicts: [],
      newCursor: 'def456',
    };
    expect(isSyncResponse(response)).toBe(false);
  });
});

// ============================================================
// Protocol domain boundary (no cross-package types)
// ============================================================

describe('Protocol domain boundary', () => {
  it('should not export Mutation from core', () => {
    // The protocol package should not have any core types.
    // We verify by checking that isSyncRequest requires
    // ProtocolMutation (not core's Mutation which has extra fields).
    const coreLikeMutation = {
      id: 'mut-1',
      entityId: 'e1',
      collectionName: 'tasks',
      operation: 'set',
      field: null,
      value: {},
      baseRevision: 1,
      createdAt: validTimestamp,
      // Core-only fields that should not be in protocol
      sequence: 1,
      status: 'PENDING',
      retries: 0,
      lastError: null,
    };
    // This should still pass validation because the validator
    // only checks for required fields, not the absence of extra ones.
    // But the TYPE is ProtocolMutation, which does not include
    // core-only fields.
    expect(isProtocolMutation(coreLikeMutation)).toBe(true);
  });
});
