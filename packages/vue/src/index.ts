/**
 * @offlinesync/vue
 *
 * Vue composables for OfflineSync integration.
 *
 * Provides useCollection, useEntity, useSyncState, and useOfflineSync
 * composables, along with the provide/inject context utilities.
 *
 * Peer dependency: vue >= 3.0.0
 */

// Injection & Context
export {
  OFFLINE_SYNC_KEY,
  provideOfflineSync,
  useOfflineSyncContext,
} from './sync-injection.js';

// Composables
export { useCollection } from './use-collection.js';
export { useSyncState, getDefaultSyncStateResult } from './use-sync-state.js';
export { useEntity } from './use-entity.js';
export {
  useOfflineSync,
  createOfflineSyncInjectionValue,
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
  CollectionComposableOptions,
  OfflineSyncInjectionValue,
  CollectionDataSource,
  EntityDataSource,
  SyncStateSource,
} from './types.js';
