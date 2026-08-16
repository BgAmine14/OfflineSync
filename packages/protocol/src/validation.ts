/**
 * Runtime validation functions for protocol messages.
 *
 * These type guards ensure that arbitrary JSON data (e.g., parsed from
 * an HTTP response) conforms to the expected protocol types.
 * They return boolean type predicates for use in TypeScript if-statements.
 */

import type {
  SyncRequest,
  SyncResponse,
  Change,
  ConflictInfo,
  ProtocolEntity,
} from './sync.js';
import type {
  SnapshotRequest,
  SnapshotResponse,
} from './snapshot.js';
import type { ProtocolMutation } from './mutation.js';
import type { ProtocolError } from './error.js';
import {
  SYNC_ERROR_CODE,
  ERROR_CLASSIFICATION,
} from './types.js';
import type { SyncErrorCode, ErrorClassification } from './types.js';

// --- Helpers ---

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNull(value: unknown): value is null {
  return value === null;
}

function isNonNullableString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isIso8601(value: unknown): value is string {
  if (!isString(value)) return false;
  // Accept any string that looks like ISO 8601.
  // Full RFC 3339 validation is too strict for practical use.
  const pattern =
    '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$';
  return new RegExp(pattern).test(value);
}

function hasField(
  obj: Record<string, unknown>,
  field: string,
): boolean {
  return field in obj;
}

function isSyncErrorCodeValue(value: unknown): value is SyncErrorCode {
  if (!isString(value)) return false;
  return (
    Object.values(SYNC_ERROR_CODE) as readonly string[]
  ).includes(value);
}

function isErrorClassificationValue(
  value: unknown,
): value is ErrorClassification {
  if (!isString(value)) return false;
  return (
    Object.values(ERROR_CLASSIFICATION) as readonly string[]
  ).includes(value);
}

// --- Protocol Entity ---

/**
 * Validates that a value conforms to the ProtocolEntity interface.
 */
export function isProtocolEntity(
  value: unknown,
): value is ProtocolEntity {
  if (!isObject(value)) return false;
  return (
    hasField(value, 'id') && isNonNullableString(value['id']) &&
    hasField(value, 'data') &&
    hasField(value, 'revision') && isNumber(value['revision']) &&
    hasField(value, 'createdAt') && isIso8601(value['createdAt']) &&
    hasField(value, 'updatedAt') && isIso8601(value['updatedAt']) &&
    hasField(value, 'isDeleted') && isBoolean(value['isDeleted'])
  );
}

// --- Protocol Mutation ---

/**
 * Validates that a value conforms to the ProtocolMutation interface.
 */
export function isProtocolMutation(
  value: unknown,
): value is ProtocolMutation {
  if (!isObject(value)) return false;
  return (
    hasField(value, 'id') && isNonNullableString(value['id']) &&
    hasField(value, 'entityId') && isNonNullableString(value['entityId']) &&
    hasField(value, 'collectionName') &&
    isNonNullableString(value['collectionName']) &&
    hasField(value, 'operation') && isNonNullableString(value['operation']) &&
    hasField(value, 'field') &&
    (isNull(value['field']) || isString(value['field'])) &&
    hasField(value, 'value') &&
    hasField(value, 'baseRevision') &&
    isNumber(value['baseRevision']) &&
    value['baseRevision'] >= 0 &&
    hasField(value, 'createdAt') && isIso8601(value['createdAt'])
  );
}

// --- Change ---

/**
 * Validates that a value conforms to the Change interface.
 */
export function isChange(value: unknown): value is Change {
  if (!isObject(value)) return false;
  return (
    hasField(value, 'serverSequence') &&
    isNumber(value['serverSequence']) &&
    value['serverSequence'] >= 0 &&
    hasField(value, 'collectionName') &&
    isNonNullableString(value['collectionName']) &&
    hasField(value, 'entity') && isProtocolEntity(value['entity']) &&
    hasField(value, 'operation') && isNonNullableString(value['operation']) &&
    hasField(value, 'field') &&
    (isNull(value['field']) || isString(value['field'])) &&
    hasField(value, 'value')
  );
}

// --- Conflict Info ---

/**
 * Validates that a value conforms to the ConflictInfo interface.
 */
export function isConflictInfo(
  value: unknown,
): value is ConflictInfo {
  if (!isObject(value)) return false;
  return (
    hasField(value, 'mutationId') &&
    isNonNullableString(value['mutationId']) &&
    hasField(value, 'entityId') &&
    isNonNullableString(value['entityId']) &&
    hasField(value, 'collectionName') &&
    isNonNullableString(value['collectionName']) &&
    hasField(value, 'clientRevision') &&
    isNumber(value['clientRevision']) &&
    value['clientRevision'] >= 0 &&
    hasField(value, 'serverRevision') &&
    isNumber(value['serverRevision']) &&
    value['serverRevision'] >= 0 &&
    hasField(value, 'serverEntity') &&
    isProtocolEntity(value['serverEntity'])
  );
}

// --- Sync Request ---

/**
 * Validates that a value conforms to the SyncRequest interface.
 */
export function isSyncRequest(value: unknown): value is SyncRequest {
  if (!isObject(value)) return false;
  if (!hasField(value, 'cursor') || !isString(value['cursor'])) {
    return false;
  }
  if (!hasField(value, 'clientId') || !isNonNullableString(value['clientId'])) {
    return false;
  }
  if (
    !hasField(value, 'mutations') ||
    !Array.isArray(value['mutations'])
  ) {
    return false;
  }
  return value['mutations'].every(isProtocolMutation);
}

// --- Sync Response ---

/**
 * Validates that a value conforms to the SyncResponse interface.
 */
export function isSyncResponse(value: unknown): value is SyncResponse {
  if (!isObject(value)) return false;
  if (
    !hasField(value, 'changes') ||
    !Array.isArray(value['changes'])
  ) {
    return false;
  }
  if (
    !hasField(value, 'acknowledgedMutationIds') ||
    !Array.isArray(value['acknowledgedMutationIds'])
  ) {
    return false;
  }
  if (
    !hasField(value, 'conflicts') ||
    !Array.isArray(value['conflicts'])
  ) {
    return false;
  }
  if (
    !hasField(value, 'newCursor') ||
    !isNonNullableString(value['newCursor'])
  ) {
    return false;
  }
  return (
    value['changes'].every(isChange) &&
    value['acknowledgedMutationIds'].every(isString) &&
    value['conflicts'].every(isConflictInfo)
  );
}

// --- Snapshot Request ---

/**
 * Validates that a value conforms to the SnapshotRequest interface.
 */
export function isSnapshotRequest(
  value: unknown,
): value is SnapshotRequest {
  if (!isObject(value)) return false;
  if (
    !hasField(value, 'clientId') ||
    !isNonNullableString(value['clientId'])
  ) {
    return false;
  }
  if (hasField(value, 'collections')) {
    if (!Array.isArray(value['collections'])) return false;
    if (!value['collections'].every(isString)) return false;
  }
  return true;
}

// --- Snapshot Response ---

/**
 * Validates that a value conforms to the SnapshotResponse interface.
 */
export function isSnapshotResponse(
  value: unknown,
): value is SnapshotResponse {
  if (!isObject(value)) return false;
  if (!hasField(value, 'entities') || !isObject(value['entities'])) {
    return false;
  }
  const entities = value['entities'] as Record<string, unknown>;
  for (const key of Object.keys(entities)) {
    if (!Array.isArray(entities[key])) return false;
    if (!(entities[key] as unknown[]).every(isProtocolEntity)) {
      return false;
    }
  }
  return (
    hasField(value, 'cursor') && isNonNullableString(value['cursor']) &&
    hasField(value, 'serverTimestamp') &&
    isIso8601(value['serverTimestamp'])
  );
}

// --- Protocol Error ---

/**
 * Validates that a value conforms to the ProtocolError interface.
 */
export function isProtocolError(value: unknown): value is ProtocolError {
  if (!isObject(value)) return false;
  return (
    hasField(value, 'code') && isSyncErrorCodeValue(value['code']) &&
    hasField(value, 'message') && isString(value['message'])
  );
}

// --- Sync Error Code ---

/**
 * Validates that a string is a valid SyncErrorCode.
 */
export function isSyncErrorCode(
  value: unknown,
): value is SyncErrorCode {
  return isSyncErrorCodeValue(value);
}

/**
 * Validates that a string is a valid ErrorClassification.
 */
export function isErrorClassification(
  value: unknown,
): value is ErrorClassification {
  return isErrorClassificationValue(value);
}