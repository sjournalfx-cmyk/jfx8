import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PairDistributionTreemapWidget } from './PairDistributionTreemapWidget';
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

const PORTRAIT = { width: 350, height: 320 };
const LANDSCAPE = { width: 800, height: 360 };
let inlineSize = PORTRAIT;

const rectFor = (el: Element) => {
  const inOverlay = !!(el.closest && el.closest('[role="dialog"]'));
  const { width, height } = inOverlay ? LANDSCAPE : inlineSize;
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
};

const trades = [
  { pair: 'EURUSD', pnl: 100 },
  { pair: 'EURUSD', pnl: 50 },
  { pair: 'GBPUSD', pnl: -40 },
] as Trade[];

const svgRectAttrs = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll('rect')).map(r =>
    [r.getAttribute('x'), r.getAttribute('y'), r.getAttribute('width'), r.getAttribute('height')].join(',')
  );

describe('PairDistributionTreemapWidget fullscreen', () => {
  // Inline SVG lives in the test container; the fullscreen overlay is portaled
  // to document.body so card/scroll ancestors can't trap it.
  const inlineTreemapSvgs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('svg')).filter(
      s => s.getAttribute('viewBox') !== '0 0 24 24' && !s.closest('[role="dialog"]')
    ) as SVGSVGElement[];
  const overlayTreemapSvgs = () =>
    Array.from(document.querySelectorAll('svg')).filter(
      s => s.getAttribute('viewBox') !== '0 0 24 24' && !!s.closest('[role="dialog"]')
    ) as SVGSVGElement[];

  beforeEach(() => {
    inlineSize = PORTRAIT;
    vi.clearAllMocks();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rectFor(this) as unknown as DOMRect;
    });
  });

  afterEach(() => {
    document.body.classList.remove('jfx-fullscreen-open');
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('restores the inline treemap layout after closing fullscreen', () => {
    const { container, unmount } = render(
      <PairDistributionTreemapWidget trades={trades} isDarkMode={true} currencySymbol="$" />
    );

    const inlineSvg = () => inlineTreemapSvgs(container)[0];

    expect(inlineSvg().getAttribute('viewBox')).toBe(`0 0 ${PORTRAIT.width} ${PORTRAIT.height}`);
    const baseline = svgRectAttrs(inlineSvg());
    expect(baseline.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('Fullscreen preview'));

    const overlay = screen.getByRole('dialog');
    expect(overlay).not.toBeNull();
    const overlaySvg = overlayTreemapSvgs()[0];
    expect(overlaySvg.getAttribute('viewBox')).toBe(`0 0 ${LANDSCAPE.width} ${LANDSCAPE.height}`);
    expect(svgRectAttrs(overlaySvg)).not.toEqual(baseline);

    fireEvent.click(screen.getByLabelText('Close fullscreen preview'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(inlineSvg().getAttribute('viewBox')).toBe(`0 0 ${PORTRAIT.width} ${PORTRAIT.height}`);
    expect(svgRectAttrs(inlineSvg())).toEqual(baseline);
    unmount();
  });

  it('recovers the inline layout when rotation finishes after closing', async () => {
    const { container, unmount } = render(
      <PairDistributionTreemapWidget trades={trades} isDarkMode={true} currencySymbol="$" />
    );

    const inlineSvg = () => inlineTreemapSvgs(container)[0];
    const baseline = svgRectAttrs(inlineSvg());

    fireEvent.click(screen.getByLabelText('Fullscreen preview'));
    expect(overlayTreemapSvgs()[0].getAttribute('viewBox')).toBe(`0 0 ${LANDSCAPE.width} ${LANDSCAPE.height}`);

    inlineSize = LANDSCAPE;
    fireEvent.click(screen.getByLabelText('Close fullscreen preview'));
    expect(screen.queryByRole('dialog')).toBeNull();

    inlineSize = PORTRAIT;
    fireEvent(window, new Event('resize'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    expect(inlineSvg().getAttribute('viewBox')).toBe(`0 0 ${PORTRAIT.width} ${PORTRAIT.height}`);
    expect(svgRectAttrs(inlineSvg())).toEqual(baseline);
    unmount();
  });

  it('keeps the treemap svg out of the layout flow', () => {
    const { container, unmount } = render(
      <PairDistributionTreemapWidget trades={trades} isDarkMode={true} currencySymbol="$" />
    );

    const svg = inlineTreemapSvgs(container)[0];
    expect(svg.getAttribute('class')).toMatch(/(^|\s)absolute(\s|$)/);
    expect(svg.getAttribute('class')).toMatch(/(^|\s)inset-0(\s|$)/);

    fireEvent.click(screen.getByLabelText('Fullscreen preview'));
    const overlaySvg = overlayTreemapSvgs()[0];
    expect(overlaySvg.getAttribute('class')).toMatch(/(^|\s)absolute(\s|$)/);
    expect(overlaySvg.getAttribute('class')).toMatch(/(^|\s)inset-0(\s|$)/);

    fireEvent.click(screen.getByLabelText('Close fullscreen preview'));
    unmount();
  });

  it('engages landscape view on open and releases it on close', () => {
    const { unmount } = render(
      <PairDistributionTreemapWidget trades={trades} isDarkMode={true} currencySymbol="$" />
    );

    expect(vi.mocked(enterLandscapeView)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Fullscreen preview'));
    expect(vi.mocked(enterLandscapeView)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close fullscreen preview'));
    expect(vi.mocked(exitLandscapeView)).toHaveBeenCalledTimes(1);
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
        <PairDistributionTreemapWidget trades={trades} isDarkMode={true} currencySymbol="$" />
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
