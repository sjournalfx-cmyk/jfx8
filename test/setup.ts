import '@testing-library/jest-dom';

/**
 * Provide a working `localStorage` for the jsdom test environment.
 *
 * Why this is needed (Node >= 22.4 / 24 / 26 + Vitest 4):
 *
 *   1. Node ships an experimental Web Storage `localStorage` global. It is
 *      defined unconditionally, but unless the process was started with
 *      `--localstorage-file` the getter resolves to `undefined` and Node logs
 *      "ExperimentalWarning: localStorage is not available because
 *      --localstorage-file was not provided."
 *   2. Vitest builds its jsdom globals with `populateGlobal`, whose key filter
 *      is: if a key already exists on globalThis, copy it over ONLY if it is on
 *      Vitest's own allow-list.
 *   3. Because Node already put `localStorage` on globalThis (`'localStorage' in
 *      globalThis === true`), that filter DROPS jsdom's perfectly good
 *      implementation — the global keeps resolving to Node's unusable stub.
 *
 * The result is `typeof localStorage === 'undefined'` inside every test, which
 * takes out test/candleStore.test.ts (14 tests) and anything else that touches
 * storage — including the trade/portfolio overlay.
 *
 * The polyfill below is deliberately conservative: it only installs when the
 * ambient `localStorage` is actually unusable, so a run that *does* pass
 * `--localstorage-file` keeps Node's real persistent implementation. It is
 * also spec-shaped enough for the code under test: `length`, `key()`, ordered
 * enumeration, and a per-origin quota error on overflow.
 */

class InMemoryStorage implements Storage {
  private map = new Map<string, string>();
  private readonly quota: number;

  constructor(quota = 5 * 1024 * 1024) {
    this.quota = quota;
  }

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    const value = this.map.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.map.size) return null;
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    const k = String(key);
    const v = String(value);
    const existing = this.map.get(k);
    const projected = this.usedBytes + (existing === undefined ? k.length + v.length : v.length - existing.length);
    if (projected > this.quota) {
      // Mirrors the browser: a QuotaExceededError, not a silent no-op, so
      // callers that test for quota handling (candleStore LRU eviction) still
      // exercise the real branch.
      const err = new Error(`Failed to execute 'setItem' on 'Storage': quota exceeded.`);
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, v);
  }

  private get usedBytes(): number {
    let total = 0;
    for (const [k, v] of this.map) total += k.length + v.length;
    return total;
  }

  // Convenience so tests can call localStorage.clear() between cases.
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.map.entries();
  }
}

function installIfBroken(name: 'localStorage' | 'sessionStorage'): boolean {
  let current: unknown;
  try {
    current = (globalThis as Record<string, unknown>)[name];
  } catch {
    current = undefined;
  }

  if (current && typeof (current as Storage).getItem === 'function') {
    try {
      (current as Storage).getItem('__jfx_probe__');
      return false; // real, working storage — leave it alone
    } catch {
      /* falls through to the polyfill */
    }
  }

  const storage = new InMemoryStorage();
  const define = (target: object) => {
    Object.defineProperty(target, name, {
      value: storage,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  };
  define(globalThis);
  // jsdom aliases window === globalThis, but keep window coherent either way.
  if (typeof window !== 'undefined' && window !== (globalThis as unknown as Window)) {
    define(window);
  }
  return true;
}

const patchedLocalStorage = installIfBroken('localStorage');
const patchedSessionStorage = installIfBroken('sessionStorage');

/**
 * When we had to substitute the storage objects, also publish the polyfill
 * class as the global `Storage` constructor so the browser contract holds:
 * `localStorage instanceof Storage === true` and the accessors live on
 * `Storage.prototype`.
 *
 * That last part matters — test/candleStore.test.ts simulates a quota failure
 * by temporarily replacing `Storage.prototype.setItem`, which only takes effect
 * if that is the prototype actually serving the instance. Pointing `Storage` at
 * the broken Node/jsdom combination instead would make the test silently
 * exercise nothing. Only done when the polyfill was installed, so a healthy
 * environment keeps its real constructor.
 */
if (patchedLocalStorage || patchedSessionStorage) {
  Object.defineProperty(globalThis, 'Storage', {
    value: InMemoryStorage,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

/**
 * jsdom implements the scroll *properties* but not the scroll *methods*.
 * `Element.scrollTo` / `scrollIntoView` / `scroll` are undefined, so any
 * component that calls one inside a useEffect throws on mount and takes its
 * whole suite with it (Analytics.test.tsx was the only casualty, but any new
 * view that scrolls on tab change would hit the same wall).
 *
 * These are observation-only in a test — record the call so a test can assert
 * the component tried to scroll, and otherwise do nothing.
 */
const SCROLL_METHODS = ['scrollTo', 'scroll', 'scrollIntoView', 'scrollBy'] as const;

for (const method of SCROLL_METHODS) {
  if (typeof Element !== 'undefined' && typeof (Element.prototype as any)[method] !== 'function') {
    Object.defineProperty(Element.prototype, method, {
      value: function scrollStub(this: Element, ...args: unknown[]) {
        (this as Element & { __jfxScrollCalls?: unknown[] }).__jfxScrollCalls ??= [];
        (this as Element & { __jfxScrollCalls?: unknown[] }).__jfxScrollCalls.push(args);
      },
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
}