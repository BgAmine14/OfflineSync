/**
 * Module declaration for Vue peer dependency.
 *
 * Provides just enough type information for TypeScript to compile
 * the composable implementations without requiring the vue package
 * to be installed at build time. At runtime, vue is provided
 * by the consumer as a peer dependency.
 */

declare module 'vue' {
  /**
   * A reactive reference that holds a mutable value.
   */
  export interface Ref<T> {
    value: T;
  }

  /**
   * A computed reference that holds a readonly derived value.
   */
  export interface ComputedRef<T> {
    readonly value: T;
  }

  /**
   * An injection key for use with provide/inject.
   *
   * @typeParam T - The type of the injected value.
   */
  export type InjectionKey<T> = symbol & { __brand: T };

  /**
   * Creates a reactive reference.
   */
  export function ref<T>(initial: T): Ref<T>;

  /**
   * Creates a readonly computed reference.
   */
  export function computed<T>(getter: () => T): ComputedRef<T>;

  /**
   * Watches a reactive source and runs a callback when it changes.
   */
  export function watch(
    source: () => unknown,
    callback: () => void,
    options?: Record<string, unknown>,
  ): void;

  /**
   * Registers a callback to be called when the component is mounted.
   */
  export function onMounted(callback: () => void): void;

  /**
   * Registers a callback to be called when the component is unmounted.
   */
  export function onUnmounted(callback: () => void): void;

  /**
   * Provides a value to descendant components.
   */
  export function provide<T>(key: InjectionKey<T>, value: T): void;

  /**
   * Injects a value provided by an ancestor component.
   */
  export function inject<T>(key: InjectionKey<T>): T | undefined;

  /**
   * Creates an injection key.
   */
  export function createInjectionKey<T>(description: string): InjectionKey<T>;
}
