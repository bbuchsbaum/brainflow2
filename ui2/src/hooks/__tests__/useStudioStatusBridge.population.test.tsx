import { afterEach, expect, it } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { useStudioStatusBridge } from '../useStudioStatusBridge';
afterEach(cleanup);
it('names Population and selected membership in the shared status bar, then restores imaging status', () => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  useSetStudioStore.getState().setActiveLens('population');
  useAppModeStore.getState().enterStudioMode();
  renderHook(() => useStudioStatusBridge());
  expect(useStatusBarStore.getState().values.mouse).toContain('Population');
  const id =
    useSetStudioStore.getState().sets[useSetStudioStore.getState().selection.activeSetId!]
      .memberIds[0];
  act(() => {
    useSetStudioStore.getState().selectPopulationMembers([id]);
  });
  expect(useStatusBarStore.getState().values.atlas).toBe('1 selected · Live summary');
  act(() => useAppModeStore.getState().enterImagingMode());
  expect(useStatusBarStore.getState().values.mouse).not.toContain('Population');
});
