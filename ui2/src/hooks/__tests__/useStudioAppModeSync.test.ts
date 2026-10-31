/**
 * QA 2026-10-31: with a surface tab in front of the Set studio tab, the
 * status bar read "Coordinate system Studio · Set studio". The app is in
 * studio mode only while the Studio tab itself is in front.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useStudioAppModeSync } from '../useStudioAppModeSync';
import { useAppModeStore } from '@/stores/appModeStore';
import { useCenterTabStore } from '@/stores/centerTabStore';

describe('useStudioAppModeSync', () => {
  beforeEach(() => {
    useAppModeStore.setState({ mode: 'imaging', previousMode: null });
    useCenterTabStore.getState().setFrontComponentType('Workspace');
  });

  it('is studio for the Studio tab and imaging when a surface tab is in front of it', () => {
    renderHook(() => useStudioAppModeSync('set-studio'));
    expect(useAppModeStore.getState().mode).toBe('studio');

    act(() => useCenterTabStore.getState().setFrontComponentType('surfaceView'));
    expect(useAppModeStore.getState().mode).toBe('imaging');

    act(() => useCenterTabStore.getState().setFrontComponentType('surfacePlaceholder'));
    expect(useAppModeStore.getState().mode).toBe('imaging');

    act(() => useCenterTabStore.getState().setFrontComponentType('Workspace'));
    expect(useAppModeStore.getState().mode).toBe('studio');
  });
});
