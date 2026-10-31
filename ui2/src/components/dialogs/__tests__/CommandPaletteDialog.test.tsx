import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteDialog } from '../CommandPaletteDialog';

describe('CommandPaletteDialog', () => {
  it('search input reaches the DOM with autocorrect, autocapitalize and spellcheck off', () => {
    render(<CommandPaletteDialog open onClose={vi.fn()} commands={[]} />);
    const input = screen.getByLabelText('Command search');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

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

  it('closes when the overlay is clicked', async () => {
    const onClose = vi.fn();

    render(
      <CommandPaletteDialog
        open
        onClose={onClose}
        commands={[
          {
            id: 'cmd.one',
            title: 'First Command',
            run: vi.fn(),
          },
        ]}
      />
    );

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.parentElement!);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('CommandPaletteDialog focus (v3 function critic)', () => {
  // A host that closes the palette like App does and restores focus to the
  // previously focused element when it closes (the Modal's focus return).
  function Host({ commands }: { commands: React.ComponentProps<typeof CommandPaletteDialog>['commands'] }) {
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <button data-testid="trigger">trigger</button>
        <input aria-label="Dialog field opened by the command" data-testid="target" />
        <CommandPaletteDialog open={open} onClose={() => setOpen(false)} commands={commands} />
      </>
    );
  }

  it.each(['Export View as Image…', 'Go to Coordinate…', 'Crosshair Settings…', 'Show Clusters'])(
    'runs "%s" after the palette has closed, so the focus it sets is kept',
    async (title) => {
      const order: string[] = [];
      render(
        <Host
          commands={[
            {
              id: 'cmd',
              title,
              run: () => {
                order.push(document.querySelector('[role="dialog"]') ? 'run-while-open' : 'run-after-close');
                (document.querySelector('[data-testid="target"]') as HTMLElement).focus();
              },
            },
          ]}
        />,
      );
      fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'Enter' });
      await waitFor(() => expect(order).toEqual(['run-after-close']));
      // Nothing moves focus back after the command ran.
      await new Promise((r) => setTimeout(r, 50));
      expect(document.activeElement).toBe(screen.getByTestId('target'));
    },
  );

  it('keys typed before the field has focus go to the query, not to app shortcuts (QA 2026-10-31 N14)', () => {
    const shortcut = vi.fn();
    const onWindow = (event: KeyboardEvent) => {
      if (!event.defaultPrevented) shortcut(event.key);
    };
    window.addEventListener('keydown', onWindow);
    try {
      render(
        <CommandPaletteDialog
          open
          onClose={vi.fn()}
          commands={[{ id: 'view.toggleRadiological', title: 'Toggle Radiological Convention', run: vi.fn() }]}
        />,
      );
      (document.activeElement as HTMLElement | null)?.blur();
      for (const key of 'radiol') fireEvent.keyDown(document.body, { key });
      expect(shortcut).not.toHaveBeenCalled();
      const input = screen.getByLabelText('Command search') as HTMLInputElement;
      expect(input.value).toBe('radiol');
      expect(screen.getByText('Toggle Radiological Convention')).toBeInTheDocument();
    } finally {
      window.removeEventListener('keydown', onWindow);
    }
  });

  it('no document listener sees a key typed while it opens (Space-to-pan), and IME composition is left alone (review L2)', () => {
    const documentCapture = vi.fn();
    document.addEventListener('keydown', documentCapture, true);
    try {
      render(<CommandPaletteDialog open onClose={vi.fn()} commands={[]} />);
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.keyDown(document.body, { key: ' ' });
      expect(documentCapture).not.toHaveBeenCalled();
      const input = screen.getByLabelText('Command search') as HTMLInputElement;
      expect(input.value).toBe(' ');
      // Composing (an input method): not captured.
      fireEvent.keyDown(document.body, { key: 'a', isComposing: true });
      fireEvent.keyDown(document.body, { key: 'a', keyCode: 229 });
      expect(input.value).toBe(' ');
      expect(documentCapture).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keydown', documentCapture, true);
    }
  });
});
