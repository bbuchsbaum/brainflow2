import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const listeners = vi.hoisted(() => new Map<string, () => void>());

vi.mock('@/utils/eventUtils', () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => {};
  }),
  safeUnlisten: vi.fn(),
}));

import { useAppSettingsMenuListener } from '../useAppSettingsMenuListener';

describe('useAppSettingsMenuListener (Brainflow › Settings…, Cmd+,)', () => {
  it('turns the native menu event into the open-app-settings window event', async () => {
    const onOpen = vi.fn();
    window.addEventListener('open-app-settings', onOpen);
    renderHook(() => useAppSettingsMenuListener());
    await waitFor(() => expect(listeners.has('app-settings-action')).toBe(true));

    listeners.get('app-settings-action')!();

    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener('open-app-settings', onOpen);
  });
});
