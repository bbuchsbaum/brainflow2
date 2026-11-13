import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioPopover } from '../StudioToolbarSlot';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const outer = vi.fn();
  render(
    <div onKeyDown={(event) => event.key === 'Escape' && outer()}>
      <StudioPopover label="Colour scale" summary="Scale" testId="panel">
        <button type="button">Fit</button>
      </StudioPopover>
      <button type="button">Elsewhere</button>
    </div>,
  );
  const details = screen.getByTestId('panel').closest('details')!;
  const summary = screen.getByLabelText('Colour scale');
  details.open = true;
  return { outer, details, summary };
}

it('Escape inside the popover closes it, goes no further, and returns focus to its trigger', () => {
  const { outer, details, summary } = setup();
  const fit = screen.getByRole('button', { name: 'Fit' });
  fit.focus();
  fireEvent.keyDown(fit, { key: 'Escape' });
  expect(details.open).toBe(false);
  // The montage's own Escape (clear the selection) does not also fire.
  expect(outer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(summary);
});

it('Escape pressed elsewhere leaves the popover alone', () => {
  const { outer, details } = setup();
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
  elsewhere.focus();
  fireEvent.keyDown(elsewhere, { key: 'Escape' });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(details.open).toBe(true);
  expect(outer).toHaveBeenCalledTimes(1);
});

it('a closed popover lets Escape through', () => {
  const { outer, details, summary } = setup();
  details.open = false;
  fireEvent.keyDown(summary, { key: 'Escape' });
  expect(outer).toHaveBeenCalledTimes(1);
});

/** A popover holding a control that opens a listbox portalled to the body. */
function PortalHarness({ outer }: { outer: () => void }) {
  const [listOpen, setListOpen] = useState(false);
  return (
    <div onKeyDown={(event) => event.key === 'Escape' && outer()}>
      <StudioPopover label="Colour scale" summary="Scale" testId="panel">
        <button type="button" aria-controls="own-list" onClick={() => setListOpen(true)}>
          Choose
        </button>
        {listOpen
          ? createPortal(
              <div data-radix-popper-content-wrapper="">
                <div
                  role="listbox"
                  id="own-list"
                  tabIndex={-1}
                  onKeyDown={(event) => {
                    // A Radix listbox closes itself on Escape (not prevented here).
                    if (event.key === 'Escape') setListOpen(false);
                  }}
                >
                  <div role="option" aria-selected tabIndex={-1}>
                    Viridis
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </StudioPopover>
      {createPortal(
        <div role="menu" data-testid="foreign-menu" tabIndex={-1}>
          another component&apos;s menu
        </div>,
        document.body,
      )}
    </div>
  );
}

async function openHarness() {
  const outer = vi.fn();
  render(<PortalHarness outer={outer} />);
  const details = screen.getByTestId('panel').closest('details')!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
  return { outer, details };
}

it('Escape in a listbox portalled from the popover closes the listbox, not the popover', async () => {
  const { details } = await openHarness();
  const option = screen.getByRole('option', { name: 'Viridis' });
  option.focus();
  fireEvent.keyDown(option, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(details.open).toBe(true);
});

it('Escape already handled inside the popover does not also close it', () => {
  const outer = vi.fn();
  render(
    <StudioPopover label="Colour scale" summary="Scale" testId="panel">
      <input aria-label="Limit" onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()} />
    </StudioPopover>,
  );
  const details = screen.getByTestId('panel').closest('details')!;
  details.open = true;
  fireEvent.keyDown(screen.getByLabelText('Limit'), { key: 'Escape' });
  expect(details.open).toBe(true);
  expect(outer).not.toHaveBeenCalled();
});

it('a press in its own portalled listbox keeps it open; one in another component’s menu closes it', async () => {
  const { details } = await openHarness();
  const option = screen.getByRole('option', { name: 'Viridis' });
  // Opening the listbox moved focus into it (as Radix does).
  act(() => option.focus());
  fireEvent.pointerDown(option);
  expect(details.open).toBe(true);
  // Owned through its trigger's aria-controls even before focus arrives.
  fireEvent.pointerDown(screen.getByRole('listbox'));
  expect(details.open).toBe(true);
  fireEvent.pointerDown(screen.getByTestId('foreign-menu'));
  expect(details.open).toBe(false);
});

it('re-places the open panel when an ancestor scrolls, as on resize', async () => {
  const outer = vi.fn();
  render(
    <div data-studio-column="" data-testid="column">
      <StudioPopover label="Colour scale" summary="Scale" testId="panel">
        <button type="button">Fit</button>
      </StudioPopover>
    </div>,
  );
  const panel = screen.getByTestId('panel');
  const trigger = screen.getByLabelText('Colour scale');
  let anchorBottom = 100;
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 10, right: 200, top: anchorBottom, bottom: anchorBottom + 100, width: 190, height: 100 }) as DOMRect,
  );
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 10, right: 60, top: anchorBottom - 20, bottom: anchorBottom, width: 50, height: 20 }) as DOMRect,
  );
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
  const details = panel.closest('details')!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  expect(panel.style.maxHeight).toBe('700px');
  // The column scrolls: the trigger is now near the bottom of the window.
  anchorBottom = 800;
  fireEvent.scroll(screen.getByTestId('column'));
  expect(panel.style.maxHeight).toBe(`${1000 - 800 - 4}px`);
  expect(outer).not.toHaveBeenCalled();
});
