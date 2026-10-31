import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../SettingsDialog';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { moduleRegistry } from '@/modules/registry';
import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';

registerFixtureModule();

describe('SettingsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    useFeatureFlagStore.getState().setExperimentalFeatures(false);
    useHoverSettingsStore.getState().setShowInStatusBar(true);
    useModuleSettingsStore.setState({
      enabled: {},
      pinned: [],
      startup: { mode: 'restore', tabs: ['orthogonal-flexible'] },
    });
  });

  it('Experimental features is off by default and persists when switched on', () => {
    render(<SettingsDialog onClose={() => {}} />);
    const experimental = screen.getByRole('switch', { name: 'Show unfinished features' });
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

  it('Modules: one switch per module with its stage; off hides its contributions', () => {
    render(<SettingsDialog onClose={() => {}} />);
    const modules = screen.getByRole('group', { name: 'Modules' });
    const fixture = within(modules).getByRole('switch', { name: 'Fixture' });
    expect(fixture).toHaveAttribute('aria-checked', 'true');
    expect(within(modules).getByText('Preview')).toBeInTheDocument();
    expect(within(modules).getByText('A module for tests.')).toBeInTheDocument();

    fireEvent.click(fixture);
    expect(fixture).toHaveAttribute('aria-checked', 'false');
    expect(useModuleSettingsStore.getState().enabled.fixture).toBe(false);
    expect(moduleRegistry.isEnabled('fixture')).toBe(false);
    expect(JSON.parse(localStorage.getItem('brainflow-modules') ?? '{}').state?.enabled).toEqual({ fixture: false });
    // Its tool leaves the Top bar list.
    const topBar = screen.getByRole('group', { name: 'Top bar' });
    expect(within(topBar).queryByRole('checkbox', { name: 'Fixture' })).toBeNull();
  });

  it('lists Analysis as an experimental module, off by default', () => {
    render(<SettingsDialog onClose={() => {}} />);
    const modules = screen.getByRole('group', { name: 'Modules' });
    const analysis = within(modules).getByRole('switch', { name: 'Analysis' });
    expect(analysis).toHaveAttribute('aria-checked', 'false');
    expect(within(modules).getByText('Experimental')).toBeInTheDocument();
    fireEvent.click(analysis);
    expect(moduleRegistry.isEnabled('analysis')).toBe(true);
    const pinned = within(screen.getByRole('group', { name: 'Top bar' })).getByRole('group', { name: 'Pinned tools' });
    expect(within(pinned).getByRole('checkbox', { name: 'Analysis' })).not.toBeChecked();
  });

  it('Top bar: pins tools and chooses startup tabs', () => {
    render(<SettingsDialog onClose={() => {}} />);
    const topBar = screen.getByRole('group', { name: 'Top bar' });
    const pinned = within(topBar).getByRole('group', { name: 'Pinned tools' });
    expect(within(pinned).getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual([
      'Set studio',
      'BIDS',
      'Fixture',
    ]);
    fireEvent.click(within(pinned).getByRole('checkbox', { name: 'Fixture' }));
    expect(useModuleSettingsStore.getState().pinned).toEqual([FIXTURE_TOOL]);

    // Restore last session is the default; a fixed list shows its choices.
    expect(within(topBar).getByRole('radio', { name: 'Restore last session' })).toHaveAttribute('aria-checked', 'true');
    expect(within(topBar).queryByRole('group', { name: 'Open at startup' })).toBeNull();
    fireEvent.click(within(topBar).getByRole('radio', { name: 'Fixed tabs' }));
    const startup = within(topBar).getByRole('group', { name: 'Open at startup' });
    expect(within(startup).getByRole('checkbox', { name: 'Orthogonal view' })).toBeChecked();
    fireEvent.click(within(startup).getByRole('checkbox', { name: 'Fixture' }));
    fireEvent.click(within(startup).getByRole('checkbox', { name: 'Mosaic view' }));
    expect(useModuleSettingsStore.getState().startup).toEqual({
      mode: 'fixed',
      tabs: ['orthogonal-flexible', 'mosaic', FIXTURE_TOOL],
    });
  });
});
