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

/**
 * Wraps React.lazy so a stale code-split chunk doesn't crash the app.
 *
 * After a new deployment, tabs that were already open still reference the
 * previous build's hashed chunk files. When the user navigates to a lazily
 * loaded view, the browser requests a chunk that no longer exists and the
 * dynamic import fails with a 404 ("Failed to fetch dynamically imported
 * module"). Instead of letting that error bubble up, we reload the page once
 * so the browser picks up the fresh index.html (and therefore the new chunk
 * hashes). The reload is guarded with a session flag to avoid an infinite
 * reload loop if the chunk is genuinely broken.
 */
export function safeLazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      if (isChunkLoadError(error)) {
        try {
          if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
            sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
            window.location.reload();
          }
        } catch {
          // sessionStorage may be unavailable (e.g. private mode) — fall through
        }
      }
      throw error;
    })
  );
}
