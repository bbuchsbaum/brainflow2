import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyPane } from '../EmptyPane';
import { Pager } from '../Pager';

describe('empty-state accessibility (v4 function critic)', () => {
  it('an empty-state action exposes its shortcut as aria-keyshortcuts', () => {
    render(
      <EmptyPane
        title="No volume loaded"
        primary={{ label: 'Open file…', onClick: vi.fn(), shortcut: 'Cmd+Shift+O' }}
      />,
    );
    expect(screen.getByRole('button', { name: /Open file/ })).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+O');
  });

  it('a pager with nothing to page never reads "Page 0 of 0"', () => {
    render(<Pager noun="page" showNoun page={1} count={0} onPageChange={vi.fn()} />);
    const group = screen.getByRole('group');
    expect(group).toHaveAccessibleName('no pages');
    expect(group).not.toHaveTextContent('0 of 0');
  });
});
