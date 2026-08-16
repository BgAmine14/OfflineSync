/**
 * @offlinesync/core
 *
 * Client-side sync engine: types, collections, mutations, sync engine.
 *
 * This package provides the primary developer-facing API for OfflineSync.
 * All storage access flows through the StorageAdapter abstraction.
 */

// Re-export storage types for consumer convenience
export type { Entity, Cursor } from '@offlinesync/storage';
export type {
  StorageAdapter,
  Transaction,
  Query,
  QueryOperator,
  QueryDefinition,
  QueryFilter,
  QuerySort,
  SortDirection,
} from '@offlinesync/storage';
export {
  QUERY_OPERATOR,
  StorageError,
  NotFoundError,
  TransactionError,
  QueryError,
  ConstraintError,
} from '@offlinesync/storage';

// Core types
export {
  OPERATION_TYPE,
  MUTATION_STATUS,
  SYNC_STATE,
  ERROR_CLASSIFICATION,
  OfflineSyncError,
  ConflictResolutionError,
  SyncConnectionError,
  SyncProtocolError,
} from './types/index.js';
export type {
  OperationType,
  Mutation,
  MutationStatus,
  SyncState,
  ErrorClassification,
} from './types/index.js';

// Connectivity
export type {
  ConnectivityDetector,
  OnConnectivityChange,
} from './connectivity-detector.js';

// Collection
export { Collection, COLLECTION_CHANGE_TYPE } from './collection.js';
export type {
  CollectionChangeType,
  CollectionChangeEvent,
  CollectionChangeCallback,
  CollectionSubscription,
  CollectionOptions,
} from './collection.js';

// Mutation system
export { MutationRecorder } from './mutation-recorder.js';
export type { IdGenerator } from './mutation-recorder.js';

export { MutationQueue } from './mutation-queue.js';
export type { MutationQueueOptions } from './mutation-queue.js';

export {
  ErrorClassifier,
} from './error-classifier.js';
export type { ClassifiedError } from './error-classifier.js';

export {
  MutationSender,
  StubMutationTransport,
} from './mutation-sender.js';
export type {
  SendResult,
  MutationTransport,
  RetryConfig,
  SendAttempt,
} from './mutation-sender.js';

// Sync engine
export { SyncEngine } from './sync-engine.js';
export type {
  SyncEngineOptions,
  SyncCycleResult,
  ConflictEvent,
} from './sync-engine.js';

export { SyncScheduler } from './sync-scheduler.js';
export type { SyncSchedulerOptions } from './sync-scheduler.js';

export { StubSyncTransport } from './sync-transport.js';
export type { SyncTransport, VersionInfo } from './sync-transport.js';

export { SyncTransportError } from '@offlinesync/transport-http';

export {
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  ManualStrategy,
  FieldMergeStrategy,
  OperationAwareStrategy,
  FunctionStrategy,
} from '@offlinesync/conflict';
export type {
  ConflictResolutionManagerOptions,
  StrategyConfig,
  BuiltInStrategyName,
  ConflictResolver,
  ConflictContext,
  ConflictResolution,
  ResolutionOutcome,
  OperationAwareConfig,
  ConflictResolveFunction,
} from '@offlinesync/conflict';

export {
  clientMutationToProtocol,
  buildSyncRequest,
  protocolEntityToClient,
  extractAcknowledgedIds,
  extractConflictIds,
  extractEntitiesFromChanges,
  extractEntitiesFromSnapshot,
} from './type-converters.js';

// Recovery & hardening
export { RecoveryManager } from './recovery-manager.js';
export type {
  RecoveryResult,
  RepairAction,
  RecoveryWarning,
  RecoveryManagerOptions,
} from './recovery-manager.js';

export { IntegrityChecker } from './integrity-checker.js';
export type {
  IntegrityIssue,
  IntegrityCheckResult,
  IntegritySummary,
  IntegrityCheckerOptions,
} from './integrity-checker.js';

export { LifecycleManager } from './lifecycle-manager.js';
export type {
  ShutdownResult,
  LifecycleManagerOptions,
} from './lifecycle-manager.js';
