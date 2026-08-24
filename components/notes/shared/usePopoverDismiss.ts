import { useEffect, useRef } from 'react';

/**
 * Closes popovers on any outside mousedown and on the Escape key.
 * Pass refs for every container that should count as "inside"
 * (trigger + popup wrapped in one ref'd element works best).
 */
export function usePopoverDismiss(
  refs: React.RefObject<HTMLElement | null>[],
  onClose: () => void,
  active: boolean = true,
  options: { closeOnEscape?: boolean } = {}
) {
  const { closeOnEscape = true } = options;
  const latest = useRef({ refs, onClose });
  latest.current = { refs, onClose };

  useEffect(() => {
    if (!active) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (latest.current.refs.some(r => r.current?.contains(target))) return;
      latest.current.onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (!closeOnEscape) return;
      if (e.key === 'Escape') latest.current.onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    if (closeOnEscape) document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [active, closeOnEscape]);
}
