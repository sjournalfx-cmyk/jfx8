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
  save: (snapshot: T) => void | Promise<void>,
  deps: unknown[],
  delay: number = 400
) {
  const latest = useRef({ getSnapshot, save });
  latest.current = { getSnapshot, save };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  // `hasPending()` only reports the debounce timer; a save already sitting in
  // the queue still counts as outstanding work for the caller.
  const inFlight = useRef(0);

  const enqueueSave = (snapshot: T) => {
    inFlight.current += 1;
    const next = saveQueue.current.then(() => latest.current.save(snapshot));
    // Keep the queue usable after a failed write while reporting the failure.
    saveQueue.current = next
      .catch((error) => {
        console.error('Autosave failed:', error);
      })
      .finally(() => {
        inFlight.current = Math.max(0, inFlight.current - 1);
      });
    return next;
  };

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
      void enqueueSave(latest.current.getSnapshot());
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const hasPending = () => timer.current !== null;
  /** True while the debounce is armed or a save is queued/in flight. */
  const isBusy = () => timer.current !== null || inFlight.current > 0;

  const flush = (force = false) => {
    const pending = timer.current !== null;
    clearTimer();
    if (!pending && !force) return;
    return enqueueSave(latest.current.getSnapshot());
  };

  const cancel = () => {
    clearTimer();
  };

  const saveNow = (snapshot: T) => enqueueSave(snapshot);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void enqueueSave(latest.current.getSnapshot());
      }
    },
    []
  );

  return { flush, cancel, hasPending, isBusy, saveNow };
}
