import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal } from '../Modal';

function ModalHarness({
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: {
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Launch
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Harness Dialog"
        size="sm"
        showCloseButton={false}
        closeOnOverlayClick={closeOnOverlayClick}
        closeOnEscape={closeOnEscape}
        initialFocusRef={inputRef}
      >
        <div className="space-y-3">
          <input ref={inputRef} aria-label="Primary input" />
          <button type="button">Secondary action</button>
        </div>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('locks scroll, traps focus at the boundaries, and restores focus after close', async () => {
    render(<ModalHarness />);

    const launchButton = screen.getByRole('button', { name: 'Launch' });
    launchButton.focus();
    expect(launchButton).toHaveFocus();

    await act(async () => {
      fireEvent.click(launchButton);
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    const input = screen.getByRole('textbox', { name: 'Primary input' });
    const secondaryAction = screen.getByRole('button', { name: 'Secondary action' });

    await waitFor(() => {
      expect(input).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(secondaryAction).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(input).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe('');
    expect(launchButton).toHaveFocus();
  });

  it('closes on overlay click when enabled', async () => {
    render(<ModalHarness />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.parentElement!);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the dialog open when overlay click and escape close are disabled', async () => {
    render(<ModalHarness closeOnOverlayClick={false} closeOnEscape={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
