/**
 * React context for OfflineSync.
 *
 * Provides the SyncEngine and collection resolver to child hooks
 * via React's context API.
 */

import * as React from 'react';
import type { OfflineSyncContextValue, OfflineSyncProviderProps } from './types.js';

/**
 * React context that carries OfflineSync state.
 *
 * Use {@link OfflineSyncProvider} to set the value,
 * and {@link useOfflineSyncContext} to read it in child hooks.
 */
export const OfflineSyncContext: React.Context<OfflineSyncContextValue | null> =
  React.createContext<OfflineSyncContextValue | null>(null);

/**
 * Read the OfflineSync context value.
 *
 * @returns The context value, or throws if used outside a provider.
 * @throws {Error} if called outside an OfflineSyncProvider.
 */
export function useOfflineSyncContext(): OfflineSyncContextValue {
  const context = React.useContext(OfflineSyncContext);
  if (context === null) {
    throw new Error(
      'useOfflineSyncContext must be used within an OfflineSyncProvider',
    );
  }
  return context;
}

/**
 * React component that provides OfflineSync context to child hooks.
 *
 * Wrap your component tree with this provider to enable
 * useCollection, useEntity, and useSyncState hooks.
 *
 * @param props - The provider props.
 * @returns A React element.
 */
export function OfflineSyncProvider(
  props: OfflineSyncProviderProps,
): unknown {
  const { engine, getCollection, children } = props;
  const contextValue = React.useMemo(
    () => ({ engine, getCollection }),
    [engine, getCollection],
  );
  return React.createElement(
    OfflineSyncContext.Provider,
    { value: contextValue },
    children,
  );
}
