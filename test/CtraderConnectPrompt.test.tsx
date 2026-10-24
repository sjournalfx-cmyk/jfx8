import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { CtraderConnectPrompt } from '../components/desktop/CtraderConnectPrompt';

describe('CtraderConnectPrompt', () => {
  it('renders a full-width centred content column with a one-line action', () => {
    const onGoConnect = vi.fn();
    render(<CtraderConnectPrompt onGoConnect={onGoConnect} />);

    const heading = screen.getByRole('heading', { name: 'Connect cTrader to trade live' });
    const content = heading.parentElement as HTMLElement;

    expect(content).toHaveClass('mx-auto', 'flex', 'w-full', 'max-w-md', 'flex-col', 'items-center', 'text-center');
    expect(screen.getByText(/demo and live accounts supported/i)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /connect ctrader/i });
    expect(button).toHaveClass('whitespace-nowrap');
    fireEvent.click(button);
    expect(onGoConnect).toHaveBeenCalledTimes(1);
  });

  it('supports custom copy', () => {
    render(<CtraderConnectPrompt title="Custom title" description="Custom description" />);

    expect(screen.getByRole('heading', { name: 'Custom title' })).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });
});

describe('Tailwind theme', () => {
  it('does not shadow Tailwind container widths with --spacing-xs..xl', () => {
    const css = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');
    const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(theme).not.toMatch(/--spacing-(?:xs|sm|md|lg|xl)\s*:/);
  });
});
