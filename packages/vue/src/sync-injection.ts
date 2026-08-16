/**
 * Vue injection key and provide/inject utilities for OfflineSync.
 *
 * Provides the SyncEngine and collection resolver to child composables
 * via Vue's provide/inject API.
 */

import * as Vue from 'vue';
import type { OfflineSyncInjectionValue } from './types.js';

/**
 * Injection key for the OfflineSync context.
 *
 * Use {@link provideOfflineSync} in a parent component and
 * {@link useOfflineSyncContext} in child composables.
 */
export const OFFLINE_SYNC_KEY: Vue.InjectionKey<OfflineSyncInjectionValue> =
  Vue.createInjectionKey<OfflineSyncInjectionValue>('offlinesync');

/**
 * Provide the OfflineSync context value to descendant components.
 *
 * Call this in a parent component's setup function.
 *
 * @param value - The OfflineSync context value to provide.
 */
export function provideOfflineSync(value: OfflineSyncInjectionValue): void {
  Vue.provide(OFFLINE_SYNC_KEY, value);
}

/**
 * Inject the OfflineSync context value.
 *
 * @returns The OfflineSync context value.
 * @throws {Error} if called outside a component that called provideOfflineSync.
 */
export function useOfflineSyncContext(): OfflineSyncInjectionValue {
  const value = Vue.inject(OFFLINE_SYNC_KEY);
  if (value === undefined) {
    throw new Error(
      'useOfflineSyncContext must be used within a component that provides OfflineSync',
    );
  }
  return value;
}
