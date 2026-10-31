import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../SettingsDialog';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

describe('SettingsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    useFeatureFlagStore.getState().setExperimentalFeatures(false);
    useHoverSettingsStore.getState().setShowInStatusBar(true);
  });

  it('Experimental features is off by default and persists when switched on', () => {
    render(<SettingsDialog onClose={() => {}} />);
    const experimental = screen.getByRole('switch', { name: 'Unfinished features' });
    expect(experimental).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(experimental);
    expect(experimental).toHaveAttribute('aria-checked', 'true');
    expect(useFeatureFlagStore.getState().experimentalFeatures).toBe(true);
    expect(JSON.parse(localStorage.getItem('brainflow-feature-flags') ?? '{}').state?.experimentalFeatures).toBe(true);
  });

  it('the pointer readout switch is the status bar Pointer group setting', () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const pointer = screen.getByRole('switch', { name: 'Pointer readout' });
    expect(pointer).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(pointer);
    expect(useHoverSettingsStore.getState().showInStatusBar).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  // qa-features-2026-10-31 §7: the first screen has an off switch.
  it('MNI anatomy at start is on by default and can be switched off (persisted)', () => {
    useLayoutSettingsStore.getState().setFirstScreenTemplate(true);
    render(<SettingsDialog onClose={() => {}} />);
    const firstScreen = screen.getByRole('switch', { name: 'MNI anatomy at start' });
    expect(firstScreen).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(firstScreen);
    expect(useLayoutSettingsStore.getState().firstScreenTemplate).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('brainflow2-layout-settings') ?? '{}').state?.firstScreenTemplate,
    ).toBe(false);
  });
});
