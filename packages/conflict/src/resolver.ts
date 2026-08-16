/**
 * ConflictResolutionManager — routes conflicts to per-collection strategies.
 *
 * The manager is configured with:
 * - A default strategy (used when no collection-specific strategy is set)
 * - Per-collection strategy overrides
 * - An optional fallback chain (tried in order if the primary fails)
 *
 * The manager is the primary API surface for @offlinesync/conflict.
 */

import type { ConflictContext, ConflictResolution, ConflictResolver } from './types.js';
import {
  ServerWinsStrategy,
  ClientWinsStrategy,
  LastWriteWinsStrategy,
  ManualStrategy,
  FieldMergeStrategy,
} from './strategies.js';

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

/**
 * Pre-built strategy names for use in configuration.
 */
export const BUILT_IN_STRATEGY = {
  SERVER_WINS: 'SERVER_WINS',
  CLIENT_WINS: 'CLIENT_WINS',
  LAST_WRITE_WINS: 'LAST_WRITE_WINS',
  MANUAL: 'MANUAL',
  FIELD_MERGE: 'FIELD_MERGE',
} as const;

export type BuiltInStrategyName =
  (typeof BUILT_IN_STRATEGY)[keyof typeof BUILT_IN_STRATEGY];

/**
 * A strategy entry: either a built-in name or a custom resolver instance.
 */
export type StrategyConfig =
  | BuiltInStrategyName
  | ConflictResolver;

/**
 * Configuration for the ConflictResolutionManager.
 */
export interface ConflictResolutionManagerOptions {
  /**
   * Default strategy to use when no collection-specific strategy is set.
   * @default 'LAST_WRITE_WINS'
   */
  readonly defaultStrategy?: StrategyConfig;
  /**
   * Per-collection strategy overrides.
   * Keys are collection names, values are strategy configs.
   */
  readonly collectionStrategies?: Readonly<Record<string, StrategyConfig>>;
  /**
   * Optional fallback chain. If the primary strategy returns
   * `resolved: false`, each fallback is tried in order.
   * The chain stops at the first strategy that resolves the conflict.
   */
  readonly fallbackChain?: readonly StrategyConfig[];
}

// -------------------------------------------------------------------
// ConflictResolutionManager
// -------------------------------------------------------------------

/**
 * Routes conflicts to the appropriate strategy.
 *
 * @example
 * ```typescript
 * const manager = new ConflictResolutionManager({
 *   defaultStrategy: BUILT_IN_STRATEGY.LAST_WRITE_WINS,
 *   collectionStrategies: {
 *     'counters': BUILT_IN_STRATEGY.FIELD_MERGE,
 *     'transactions': BUILT_IN_STRATEGY.MANUAL,
 *   },
 * });
 *
 * const resolution = manager.resolve(conflictContext);
 * if (resolution.resolved) {
 *   // Apply resolvedData locally and re-enqueue
 * }
 * ```
 */
export class ConflictResolutionManager {
  private readonly strategies = new Map<string, ConflictResolver>();
  private readonly collectionStrategies = new Map<string, ConflictResolver>();
  private readonly fallbackChain: ConflictResolver[];
  private readonly defaultResolver: ConflictResolver;

  constructor(options: ConflictResolutionManagerOptions = {}) {
    const defaultName = options.defaultStrategy ?? BUILT_IN_STRATEGY.LAST_WRITE_WINS;
    this.defaultResolver = this.instantiateStrategy(defaultName);

    if (options.collectionStrategies !== undefined) {
      for (const [collection, config] of Object.entries(options.collectionStrategies)) {
        this.collectionStrategies.set(
          collection,
          this.instantiateStrategy(config),
        );
      }
    }

    this.fallbackChain = (options.fallbackChain ?? []).map((c) =>
      this.instantiateStrategy(c),
    );
  }

  /**
   * Resolve a conflict using the appropriate strategy.
   *
   * 1. Looks up the collection-specific strategy
   * 2. Falls back to the default strategy
   * 3. If the primary strategy returns `resolved: false`,
   *    tries each strategy in the fallback chain
   *
   * @param context - The conflict context.
   * @returns The resolution result.
   */
  resolve(context: ConflictContext): ConflictResolution {
    const primary = this.collectionStrategies.get(context.collectionName)
      ?? this.defaultResolver;

    const result = primary.resolve(context);
    if (result.resolved) {
      return result;
    }

    // Try fallback chain
    for (const fallback of this.fallbackChain) {
      const fallbackResult = fallback.resolve(context);
      if (fallbackResult.resolved) {
        return fallbackResult;
      }
    }

    return result;
  }

  /**
   * Register a custom strategy by name.
   */
  registerStrategy(name: string, resolver: ConflictResolver): void {
    this.strategies.set(name, resolver);
  }

  /**
   * Set the strategy for a specific collection at runtime.
   */
  setCollectionStrategy(
    collectionName: string,
    config: StrategyConfig,
  ): void {
    this.collectionStrategies.set(
      collectionName,
      this.instantiateStrategy(config),
    );
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  private instantiateStrategy(config: StrategyConfig): ConflictResolver {
    if (typeof config === 'object') {
      return config;
    }

    switch (config) {
      case BUILT_IN_STRATEGY.SERVER_WINS:
        return new ServerWinsStrategy();
      case BUILT_IN_STRATEGY.CLIENT_WINS:
        return new ClientWinsStrategy();
      case BUILT_IN_STRATEGY.LAST_WRITE_WINS:
        return new LastWriteWinsStrategy();
      case BUILT_IN_STRATEGY.MANUAL:
        return new ManualStrategy();
      case BUILT_IN_STRATEGY.FIELD_MERGE:
        return new FieldMergeStrategy();
      default: {
        const exhaustive: never = config;
        // This ensures compile-time exhaustiveness checking
        return exhaustive;
      }
    }
  }
}