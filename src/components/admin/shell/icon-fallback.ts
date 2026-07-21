/**
 * Root-cause guard for the admin icon registry. `Ic` is keyed by string, so
 * `Ic.Clock`, `Ic.Box`, a typo, or a dynamic `Ic[name]` all type-check yet
 * return `undefined` when the key isn't in the map — and rendering `<undefined />`
 * throws React's "Element type is invalid" at runtime, which the compiler never
 * catches.
 *
 * withIconFallback wraps the registry in a Proxy so every missing string key
 * resolves to a safe `fallback` component instead of `undefined`. A wrong icon
 * name then degrades to a visible placeholder rather than crashing the page.
 * Pure and DOM-free (test:icon-fallback).
 */
export function withIconFallback<T>(registry: Record<string, T>, fallback: T): Record<string, T> {
  return new Proxy(registry, {
    get(target, prop, receiver) {
      // Symbols (Symbol.iterator, react internals, etc.) pass straight through —
      // only string icon lookups get the fallback.
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      const value = target[prop];
      return value === undefined ? fallback : value;
    },
  });
}
