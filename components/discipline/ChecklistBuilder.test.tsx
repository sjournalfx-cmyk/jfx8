import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChecklistBuilder } from './ChecklistBuilder';

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe('ChecklistBuilder hook stability (regression: rendered-more-hooks crash)', () => {
  it('mounts, re-renders with new props, unmounts and remounts cleanly', () => {
    const first = render(
      <React.StrictMode>
        <ChecklistBuilder />
      </React.StrictMode>,
    );
    expect(first.getByText('No rules yet')).toBeTruthy();
    first.rerender(
      <React.StrictMode>
        <ChecklistBuilder isDarkMode={false} />
      </React.StrictMode>,
    );
    expect(first.getByRole('button', { name: 'New rule' })).toBeTruthy();
    first.unmount();
    const second = render(<ChecklistBuilder />);
    expect(second.getByRole('button', { name: 'New rule' })).toBeTruthy();
    second.unmount();
  });

  it('adds a rule via bottom-sheet composer, edits via tap, opens help, deletes in edit mode', () => {
    render(<ChecklistBuilder />);
    expect(screen.getByText('No rules yet')).toBeTruthy();

    // Open composer
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByPlaceholderText('New rule…'), { target: { value: 'Test rule?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByText('Test rule?')).toBeTruthy();

    // Tap text to edit
    fireEvent.click(screen.getByText('Test rule?'));
    const editBox = document.querySelector('input[value="Test rule?"]') as HTMLInputElement;
    expect(editBox).toBeTruthy();
    fireEvent.change(editBox, { target: { value: 'Edited rule?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(screen.getByText('Edited rule?')).toBeTruthy();

    // Help drawer opens with all three phases
    fireEvent.click(screen.getByRole('button', { name: 'How do strategy rules work?' }));
    expect(document.body.textContent).toContain('Pre-Entry Checks');
    expect(document.body.textContent).toContain('In-Trade Management');
    expect(document.body.textContent).toContain('Post-Trade Review');

    // Delete from edit mode
    fireEvent.click(screen.getByText('Edited rule?'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(screen.queryByText('Edited rule?')).toBeNull();
  });

  it('moves phases in edit mode via segmented chips', () => {
    render(<ChecklistBuilder />);
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByPlaceholderText('New rule…'), { target: { value: 'Phase rule?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    fireEvent.click(screen.getByText('Phase rule?'));
    const editInput = document.querySelector('input[value="Phase rule?"]') as HTMLInputElement;
    expect(editInput).toBeTruthy();
    const editCard = editInput.closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(editCard).getByRole('button', { name: 'In' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    // NOTE: labels are mixed-case in the DOM ('In-Trade Management') — CSS
    // uppercase only affects rendering, not text matching.
    expect(screen.getByText('In-Trade Management')).toBeTruthy();
  });

  it('filters rules by phase pills', () => {
    render(<ChecklistBuilder />);
    // Add a pre rule
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByPlaceholderText('New rule…'), { target: { value: 'Pre rule' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    // Add an in-trade rule
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New rule' })).getByRole('button', { name: 'In' }));
    fireEvent.change(screen.getByPlaceholderText('New rule…'), { target: { value: 'In rule' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByText('Pre rule')).toBeTruthy();
    expect(screen.getByText('In rule')).toBeTruthy();

    // Filter to In — Pre rule hidden
    fireEvent.click(screen.getByRole('button', { name: /^In \d+$/ }));
    expect(screen.queryByText('Pre rule')).toBeNull();
    expect(screen.getByText('In rule')).toBeTruthy();

    // Back to All
    fireEvent.click(screen.getByRole('button', { name: /^All \d+$/ }));
    expect(screen.getByText('Pre rule')).toBeTruthy();
    expect(screen.getByText('In rule')).toBeTruthy();
  });
});
