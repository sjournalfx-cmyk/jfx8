import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DrawingLayer } from './DrawingLayer';

const baseProps = {
  drawings: [],
  currentDrawing: null,
  selectedDrawingId: null,
  selectedIds: [],
  mousePos: null,
  containerWidth: 800,
  containerHeight: 400,
  activeTool: 'cursor',
  hoveredDrawingId: null,
  isSelectBarMode: false,
  onMouseDownHandle: vi.fn(),
  onSelectDrawing: vi.fn(),
  onHoverDrawing: vi.fn(),
  tick: 0,
  isLocked: false,
  isDarkMode: true,
};

describe('DrawingLayer hooks order', () => {
  it('keeps the same hook order when the chart attaches after mount', () => {
    const { rerender } = render(
      <DrawingLayer {...baseProps} chart={null} series={null} />
    );

    expect(() =>
      rerender(
        <DrawingLayer
          {...baseProps}
          chart={{} as any}
          series={{} as any}
        />
      )
    ).not.toThrow();
  });
});
