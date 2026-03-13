import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrosshairSettingsDialog } from '../CrosshairSettingsDialog';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';

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
  activeColor: '#ffff00',
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

    const visibleSwitch = await screen.findByRole('switch');
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

    const visibleSwitch = await screen.findByRole('switch');
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

    const visibleSwitch = await screen.findByRole('switch');
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
});
