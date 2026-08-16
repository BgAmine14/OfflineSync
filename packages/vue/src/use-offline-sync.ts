/**
 * Main Vue composable for OfflineSync.
 *
 * Provides access to the OfflineSync injection context
 * for advanced usage.
 */

import type { SyncEngine } from '@offlinesync/core';
import type { Collection } from '@offlinesync/core';
import type { OfflineSyncInjectionValue } from './types.js';
import { useOfflineSyncContext } from './sync-injection.js';

/**
 * Configuration for the useOfflineSync composable.
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
 * Return value of the useOfflineSync composable.
 */
export interface UseOfflineSyncResult {
  /** The current injection value. */
  readonly injectionValue: OfflineSyncInjectionValue;
}

/**
 * Main Vue composable that provides access to the OfflineSync context.
 *
 * @param config - The OfflineSync configuration.
 * @returns The context value containing engine and collection resolver.
 */
export function useOfflineSync(
  config: UseOfflineSyncConfig,
): UseOfflineSyncResult {
  const context = useOfflineSyncContext();

  return {
    injectionValue: {
      engine: context.engine,
      getCollection: config.getCollection,
    },
  };
}

/**
 * Create an OfflineSyncInjectionValue from a config.
 *
 * This is a plain function for use outside of Vue components.
 *
 * @param config - The configuration.
 * @returns An injection value.
 */
export function createOfflineSyncInjectionValue(
  config: UseOfflineSyncConfig,
): OfflineSyncInjectionValue {
  return {
    engine: config.engine,
    getCollection: config.getCollection,
  };
}
