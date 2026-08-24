import { useEffect, useRef } from 'react';

/**
 * Debounced autosave: schedules `save(getSnapshot())` after `deps` settle
 * for `delay` ms, and flushes any pending save on unmount so closing or
 * navigating away never loses edits.
 *
 * Keep local state instant; pass a version counter (or the changing values
 * themselves) as `deps` to trigger scheduling. flush() is a no-op when
 * nothing is pending (use flush(true) to force a save), and cancel()
 * drops a pending save without writing — for callers that persist
 * explicitly right after.
 */
export function useAutosave<T>(
  getSnapshot: () => T,
  save: (snapshot: T) => void,
  deps: unknown[],
  delay: number = 400
) {
  const latest = useRef({ getSnapshot, save });
  latest.current = { getSnapshot, save };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current.save(latest.current.getSnapshot());
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const hasPending = () => timer.current !== null;

  const flush = (force = false) => {
    const pending = timer.current !== null;
    clearTimer();
    if (!pending && !force) return;
    latest.current.save(latest.current.getSnapshot());
  };

  const cancel = () => {
    clearTimer();
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        latest.current.save(latest.current.getSnapshot());
      }
    },
    []
  );

  return { flush, cancel, hasPending };
}
