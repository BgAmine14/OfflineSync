/**
 * Pluggable connectivity detection.
 *
 * This interface abstracts connectivity detection so the sync engine
 * is not hardcoded to navigator.onLine or any specific mechanism.
 *
 * Implementations can use:
 * - navigator.onLine (browsers)
 * - NetInfo (React Native)
 * - Custom health-check endpoints
 * - mDNS/UDP presence detection (LAN)
 * - Always-connected stubs (testing)
 */

/**
 * Callback invoked when connectivity status changes.
 */
type OnConnectivityChange = (isOnline: boolean) => void;

/**
 * Pluggable connectivity detector.
 *
 * The sync engine uses this to detect when the network
 * is available for synchronization, without being coupled
 * to any specific detection mechanism.
 */
export interface ConnectivityDetector {
  /**
   * Whether the client is currently considered online.
   */
  readonly isOnline: boolean;

  /**
   * Register a callback to be invoked when connectivity changes.
   * Returns a cleanup function that removes the listener.
   */
  onConnectivityChange(callback: OnConnectivityChange): () => void;

  /**
   * Release any resources held by the detector.
   */
  dispose(): void;
}

export type { OnConnectivityChange };
