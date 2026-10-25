import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrosshairSettingsDialog } from '../CrosshairSettingsDialog';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';
import { DEFAULT_SETTINGS, MEDICAL_COLOR_PRESETS } from '@/stores/crosshairSettingsStore';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { mockUseCrosshairSettings } = vi.hoisted(() => ({
  mockUseCrosshairSettings: vi.fn(),
}));

vi.mock('@/contexts/CrosshairContext', () => ({
  useCrosshairSettings: mockUseCrosshairSettings,
}));

const baseSettings: CrosshairSettings = {
  visible: true,
  activeColor: '#facc15',
  activeThickness: 1,
  activeStyle: 'solid',
  showMirror: false,
  mirrorColor: '#ff0000',
  mirrorOpacity: 0.6,
  mirrorThickness: 1,
  mirrorStyle: 'dashed',
  autoContrast: false,
  snapToVoxel: true,
  showCoordinates: false,
  coordinateFormat: 'mm',
};

describe('CrosshairSettingsDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    mockUseCrosshairSettings.mockReset();
  });

  function setup() {
    const onClose = vi.fn();
    const updateSettings = vi.fn();
    mockUseCrosshairSettings.mockReturnValue({
      settings: baseSettings,
      updateSettings,
    });

    render(<CrosshairSettingsDialog onClose={onClose} />);

    return { onClose, updateSettings };
  }

  it('reverts live preview changes when cancelled', async () => {
    const { onClose, updateSettings } = setup();

    const visibleSwitch = await screen.findByRole('switch', { name: 'Show crosshairs' });
    await act(async () => {
      fireEvent.click(visibleSwitch);
    });

    expect(updateSettings).toHaveBeenCalledWith({ visible: false });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(updateSettings).toHaveBeenLastCalledWith(baseSettings);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('treats overlay dismiss as cancel and restores the initial settings', async () => {
    const { onClose, updateSettings } = setup();

    const visibleSwitch = await screen.findByRole('switch', { name: 'Show crosshairs' });
    await act(async () => {
      fireEvent.click(visibleSwitch);
    });

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(dialog.parentElement!);
    });

    expect(updateSettings).toHaveBeenLastCalledWith(baseSettings);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps live preview changes when finished with the keyboard shortcut', async () => {
    const { onClose, updateSettings } = setup();

    const visibleSwitch = await screen.findByRole('switch', { name: 'Show crosshairs' });
    await act(async () => {
      fireEvent.click(visibleSwitch);
    });

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ visible: false });
  });

  it('Reset restores the store defaults exactly (green crosshair)', async () => {
    const { updateSettings } = setup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    });

    expect(updateSettings).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
    expect(updateSettings.mock.lastCall?.[0].activeColor).toBe('#5fe0a0');
  });

  it('offers the colour presets as named swatches with a pressed state', async () => {
    const { updateSettings } = setup();

    const group = await screen.findByRole('group', { name: 'Color presets' });
    const swatches = Array.from(group.querySelectorAll('button'));
    expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual(
      MEDICAL_COLOR_PRESETS.map((p) => p.name)
    );
    // baseSettings.activeColor is #facc15 = the Yellow preset.
    expect(screen.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Green (default)' })).toHaveAttribute('aria-pressed', 'false');

    // Selection is an inner ring (box-shadow), focus a separate outline, so
    // both can show at once on a focused selected swatch.
    const yellow = screen.getByRole('button', { name: 'Yellow' });
    expect(yellow.style.boxShadow).toContain('inset');
    expect(yellow.className).toContain('focus-visible:outline-2');
    expect(yellow.className).toContain('h-5 w-5');
    expect(screen.queryByRole('button', { name: 'Amber' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Orange' }));
    });
    expect(updateSettings).toHaveBeenLastCalledWith({ activeColor: '#ff7a1a' });
    expect(screen.getByRole('button', { name: 'Orange' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a Centre gap switch (on when unset) and names the sliders', async () => {
    const { updateSettings } = setup();
    const gap = await screen.findByRole('switch', { name: 'Centre gap' });
    expect(gap).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      fireEvent.click(gap);
    });
    expect(updateSettings).toHaveBeenLastCalledWith({ centerGap: false });
    expect(screen.getByRole('slider', { name: 'Thickness' })).toBeTruthy();
  });

  it('does not advertise a crosshair hotkey (c is go-to-centre)', async () => {
    setup();
    await screen.findByRole('switch', { name: 'Show crosshairs' });
    expect(screen.queryByText(/hotkey/i)).toBeNull();
  });
});
