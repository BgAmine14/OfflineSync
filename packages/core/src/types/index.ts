/**
 * Re-export all client-side types.
 */

export type { Entity, Cursor } from '@offlinesync/storage';

export {
  OPERATION_TYPE,
  MUTATION_STATUS,
} from './mutation.js';
export type { OperationType, Mutation, MutationStatus } from './mutation.js';

export { SYNC_STATE } from './sync-state.js';
export type { SyncState } from './sync-state.js';

export {
  ERROR_CLASSIFICATION,
  OfflineSyncError,
  ConflictResolutionError,
  SyncConnectionError,
  SyncProtocolError,
} from './errors.js';
export type {
  ErrorClassification,
} from './errors.js';
