import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteDialog } from '../CommandPaletteDialog';

describe('CommandPaletteDialog', () => {
  it('filters commands by query text', () => {
    const onClose = vi.fn();

    render(
      <CommandPaletteDialog
        open
        onClose={onClose}
        commands={[
          {
            id: 'cmd.mount',
            title: 'Mount Directory',
            keywords: ['file', 'mount'],
            run: vi.fn(),
          },
          {
            id: 'cmd.surface',
            title: 'Show Surfaces Panel',
            keywords: ['panel', 'surface'],
            run: vi.fn(),
          },
        ]}
      />
    );

    const input = screen.getByLabelText('Command search');
    fireEvent.change(input, { target: { value: 'surface' } });

    expect(screen.getByText('Show Surfaces Panel')).toBeInTheDocument();
    expect(screen.queryByText('Mount Directory')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation and enter-to-run', async () => {
    const onClose = vi.fn();
    const runFirst = vi.fn();
    const runSecond = vi.fn();

    render(
      <CommandPaletteDialog
        open
        onClose={onClose}
        commands={[
          {
            id: 'cmd.one',
            title: 'First Command',
            run: runFirst,
          },
          {
            id: 'cmd.two',
            title: 'Second Command',
            run: runSecond,
          },
        ]}
      />
    );

    const input = screen.getByLabelText('Command search');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(runSecond).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(runFirst).not.toHaveBeenCalled();
  });
});
