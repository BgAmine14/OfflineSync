/**
 * @offlinesync/react
 *
 * React hooks for OfflineSync integration.
 *
 * Provides useCollection, useEntity, useSyncState, and useOfflineSync
 * hooks, along with the OfflineSyncProvider context component.
 *
 * Peer dependency: react >= 17.0.0
 */

// Context & Provider
export {
  OfflineSyncContext,
  OfflineSyncProvider,
  useOfflineSyncContext,
} from './sync-context.js';

// Hooks
export { useCollection } from './use-collection.js';
export { useSyncState, createEngineSyncStateSource, getDefaultSyncStateResult } from './use-sync-state.js';
export { useEntity } from './use-entity.js';
export {
  useOfflineSync,
  createOfflineSyncContextValue,
} from './use-offline-sync.js';
export type { UseOfflineSyncConfig, UseOfflineSyncResult } from './use-offline-sync.js';

// Logic layer (for advanced usage and testing)
export {
  createCollectionController,
  createInitialCollectionState,
  handleCollectionEntitiesLoaded,
  handleCollectionError,
  handleCollectionSyncStateChange,
} from './collection-logic.js';
export type { CollectionController, CollectionControllerOptions } from './collection-logic.js';

export {
  createEntityController,
  createInitialEntityState,
  handleEntityLoaded,
  handleEntityNotFound,
  handleEntityError,
} from './entity-logic.js';
export type { EntityController, EntityControllerOptions } from './entity-logic.js';

export {
  createSyncStateController,
  getDefaultSyncState,
  handleSyncStateChange,
} from './sync-state-logic.js';
export type { SyncStateController } from './sync-state-logic.js';

// Types
export type {
  UseCollectionResult,
  UseEntityResult,
  CollectionHookOptions,
  OfflineSyncContextValue,
  OfflineSyncProviderProps,
  CollectionDataSource,
  EntityDataSource,
  SyncStateSource,
} from './types.js';
