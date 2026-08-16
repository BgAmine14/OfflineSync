/**
 * @offlinesync/conflict
 *
 * Conflict resolution strategies for OfflineSync.
 *
 * This package provides:
 * - ConflictResolver interface (pure function contract)
 * - Built-in strategies: ServerWins, ClientWins, LastWriteWins,
 *   FieldMerge, Manual
 * - ConflictResolutionManager for per-collection routing
 */

// Types
export {
  RESOLUTION_OUTCOME,
} from './types.js';
export type {
  ResolutionOutcome,
  ConflictResolution,
  ConflictContext,
  ConflictResolver,
} from './types.js';

// Strategies
export {
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  ManualStrategy,
  FieldMergeStrategy,
  OperationAwareStrategy,
  FunctionStrategy,
} from './strategies.js';
export type {
  OperationAwareConfig,
  ConflictResolveFunction,
} from './strategies.js';

// Manager
export {
  ConflictResolutionManager,
  BUILT_IN_STRATEGY,
} from './resolver.js';
export type {
  BuiltInStrategyName,
  StrategyConfig,
  ConflictResolutionManagerOptions,
} from './resolver.js';
