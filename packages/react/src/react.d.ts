/**
 * Module declaration for React peer dependency.
 *
 * Provides just enough type information for TypeScript to compile
 * the hook implementations without requiring the react package
 * to be installed at build time. At runtime, react is provided
 * by the consumer as a peer dependency.
 */

declare module 'react' {
  /**
   * Represents a React element (the return type of createElement).
   */
  export type ReactElement = unknown;

  /**
   * Represents anything that can be rendered inside JSX.
   */
  export type ReactNode = unknown;

  /**
   * A function that updates state.
   */
  export type Dispatch<A = unknown> = (value: A | ((prevState: A) => A)) => void;

  /**
   * A React context that can hold a value of type T.
   */
  export interface Context<T> {
    readonly Provider: { readonly props: { value: T } };
    readonly Consumer: unknown;
  }

  /**
   * Creates a stateful value.
   */
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<S>];

  /**
   * Runs a side effect after render.
   */
  export function useEffect(
    effect: () => undefined | (() => void),
    deps?: readonly unknown[],
  ): void;

  /**
   * Reads a context value.
   */
  export function useContext<T>(context: Context<T>): T;

  /**
   * Memoizes a computed value.
   */
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

  /**
   * Memoizes a callback function.
   */
  export function useCallback<T extends (...args: unknown[]) => unknown>(
    callback: T,
    deps: readonly unknown[],
  ): T;

  /**
   * Creates a context object.
   */
  export function createContext<T>(defaultValue: T): Context<T>;

  /**
   * Creates a React element.
   */
  export function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: ReactNode[]
  ): ReactElement;
}
