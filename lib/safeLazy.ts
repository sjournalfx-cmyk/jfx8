import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_FLAG = 'jfx_chunk_reload_attempted';

const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Loading chunk',
  'ChunkLoadError',
];

const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

function reloadForFreshBuild(): void {
  const url = new URL(window.location.href);
  // A normal reload may still receive a cached HTML document. A unique query
  // parameter makes Vercel serve the current index.html, whose chunk hashes
  // match the active deployment.
  url.searchParams.set('jfx_chunk_reload', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Wraps React.lazy so a stale code-split chunk doesn't crash the app.
 *
 * After a new deployment, tabs that were already open still reference the
 * previous build's hashed chunk files. When the user navigates to a lazily
 * loaded view, the browser requests a chunk that no longer exists and the
 * dynamic import fails with a 404 ("Failed to fetch dynamically imported
 * module"). Instead of letting that error bubble up, we reload the page once
 * so the browser picks up the fresh index.html (and therefore the new chunk
 * hashes). The reload is guarded to avoid an infinite loop if the chunk is
 * genuinely broken, and the guard is cleared after a successful lazy import.
 */
export function safeLazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().then((module) => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
      } catch {
        // Storage can be unavailable, for example in private browsing.
      }
      return module;
    }).catch((error: unknown) => {
      if (isChunkLoadError(error)) {
        try {
          if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
            sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
            reloadForFreshBuild();
          }
        } catch {
          // Storage may be unavailable. A cache-busting reload is still the
          // best recovery path and avoids leaving the user on a crash UI.
          reloadForFreshBuild();
        }
      }
      throw error;
    })
  );
}
