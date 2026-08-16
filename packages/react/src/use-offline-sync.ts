/**
 * Main React hook that initializes OfflineSync.
 *
 * Creates the SyncEngine and SyncScheduler, manages their
 * lifecycle, and provides them via the OfflineSyncProvider context.
 */

import type { SyncEngine } from '@offlinesync/core';
import type { OfflineSyncContextValue } from './types.js';
import type { Collection } from '@offlinesync/core';
import { useOfflineSyncContext } from './sync-context.js';

/**
 * Configuration for initializing OfflineSync.
 */
export interface UseOfflineSyncConfig {
  /** The sync engine instance. */
  readonly engine: SyncEngine;
  /** Resolves a collection by name. */
  readonly getCollection: <T>(
    collectionName: string,
  ) => Collection<T> | undefined;
}

/**
 * Return value of the useOfflineSync hook.
 */
export interface UseOfflineSyncResult {
  /** The current context value. */
  readonly contextValue: OfflineSyncContextValue;
}

/**
 * Main React hook that provides access to the OfflineSync context.
 *
 * This hook reads the OfflineSyncProvider context and returns
 * the context value for advanced usage. In most cases, use
 * useCollection, useEntity, or useSyncState instead.
 *
 * @param config - The OfflineSync configuration.
 * @returns The context value containing engine and collection resolver.
 */
export function useOfflineSync(
  config: UseOfflineSyncConfig,
): UseOfflineSyncResult {
  const context = useOfflineSyncContext();

  return {
    contextValue: {
      engine: context.engine,
      getCollection: config.getCollection,
    },
  };
}

/**
 * Create an OfflineSyncContextValue from a config.
 *
 * This is a plain function for use outside of React components.
 *
 * @param config - The configuration.
 * @returns A context value.
 */
export function createOfflineSyncContextValue(
  config: UseOfflineSyncConfig,
): OfflineSyncContextValue {
  return {
    engine: config.engine,
    getCollection: config.getCollection,
  };
}
