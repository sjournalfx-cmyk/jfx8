import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { TimeAnalysisMatrixWidget } from './TimeAnalysisMatrixWidget';
import { Trade } from '../../types';

vi.mock('../../lib/orientation', () => ({
  getOrientationLock: vi.fn(() => 'auto'),
  lockOrientation: vi.fn(() => Promise.resolve()),
  unlockOrientation: vi.fn(() => Promise.resolve()),
  enterLandscapeView: vi.fn(() => Promise.resolve('locked')),
  exitLandscapeView: vi.fn(() => Promise.resolve()),
}));

const { mockAddToast } = vi.hoisted(() => ({ mockAddToast: vi.fn() }));

vi.mock('../ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

import { enterLandscapeView, exitLandscapeView } from '../../lib/orientation';

const trades = [
  { pair: 'EURUSD', pnl: 100, result: 'Win', date: '2023-01-02', time: '10:00' },
  { pair: 'GBPUSD', pnl: -40, result: 'Loss', date: '2023-01-03', time: '14:00' },
] as Trade[];

describe('TimeAnalysisMatrixWidget fullscreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.classList.remove('jfx-fullscreen-open');
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('opens a fullscreen heatmap and restores the inline view on close', () => {
    const { unmount } = render(
      <TimeAnalysisMatrixWidget trades={trades} isDarkMode={true} currencySymbol="$" />
    );

    expect(screen.getByText('Time-of-Day Performance')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Fullscreen preview'));
    expect(vi.mocked(enterLandscapeView)).toHaveBeenCalledTimes(1);

    // Overlay is portaled to document.body so card/scroll ancestors can't trap it.
    const overlay = screen.getByRole('dialog');
    expect(overlay).not.toBeNull();
    expect(document.body.classList.contains('jfx-fullscreen-open')).toBe(true);
    const scope = within(overlay as HTMLElement);
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(scope.getByText(day)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByLabelText('Close fullscreen preview'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(exitLandscapeView)).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Time-of-Day Performance')).toBeInTheDocument();
    unmount();
  });

  it('shows a rotate hint and toast when the landscape lock fails', async () => {
    vi.mocked(enterLandscapeView).mockRejectedValueOnce(new Error('lock unsupported'));

    const origMatchMedia = window.matchMedia;
    let mqHandler: ((e: { matches: boolean }) => void) | null = null;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn((_type: string, h: any) => { mqHandler = h; }),
        removeEventListener: vi.fn(),
      })),
    });

    try {
      const { unmount } = render(
        <TimeAnalysisMatrixWidget trades={trades} isDarkMode={true} currencySymbol="$" />
      );

      fireEvent.click(screen.getByLabelText('Fullscreen preview'));
      await act(async () => {});

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Landscape unavailable' })
      );
      expect(screen.getByText('Rotate your device for landscape view')).toBeInTheDocument();

      act(() => { mqHandler?.({ matches: false }); });
      expect(screen.queryByText('Rotate your device for landscape view')).toBeNull();

      fireEvent.click(screen.getByLabelText('Close fullscreen preview'));
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: origMatchMedia,
      });
    }
  });
});
