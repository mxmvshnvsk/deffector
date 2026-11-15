/**
 * The agent runs in browsers, Node (SSR, tests) and React Native. These helpers
 * read optional globals only when they exist.
 */

/** High-resolution time where `performance` exists, wall-clock time elsewhere. */
export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** In Node a pending timer keeps the process alive; the agent's timers must not. */
export function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void } | null | undefined)?.unref?.();
}

export function canSetTimers(): boolean {
  return typeof setTimeout !== 'undefined';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The page location; there is none in Node, React Native and workers without a document. */
export function pageLocation(): Location | undefined {
  return typeof globalThis.location !== 'undefined' ? globalThis.location : undefined;
}

export function pageUrl(): string | undefined {
  return pageLocation()?.href;
}

/** A box that holds its value weakly where `WeakRef` exists, strongly where it does not. */
export interface WeakBox<Value extends object> {
  deref(): Value | undefined;
}

const WeakRefCtor = (globalThis as { WeakRef?: typeof WeakRef }).WeakRef;

/**
 * `WeakRef` is in every environment the agent supports (Chrome/Edge 116+,
 * Firefox 140+, Node 18+). The strong fallback only keeps older ones working,
 * at the cost of the retention the weak box exists to avoid.
 */
export function weakBox<Value extends object>(value: Value): WeakBox<Value> {
  if (WeakRefCtor) return new WeakRefCtor(value);
  return { deref: () => value };
}

const RegistryCtor = (globalThis as { FinalizationRegistry?: typeof FinalizationRegistry })
  .FinalizationRegistry;

/** Reports a key once its object is collected; no-op where the runtime cannot tell. */
export function createCollectionWatcher<Key>(
  onCollected: (key: Key) => void,
): (target: object, key: Key) => void {
  if (!RegistryCtor) return () => {};
  const registry = new RegistryCtor<Key>(onCollected);
  return (target, key) => registry.register(target, key);
}
