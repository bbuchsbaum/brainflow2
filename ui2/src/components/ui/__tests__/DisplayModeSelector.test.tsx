import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Workspace, WorkspaceType } from '@/types/workspace';

const workspaceStoreState = vi.hoisted(() => ({
  workspaces: new Map<string, Workspace>(),
  activeWorkspaceId: null as string | null,
  createWorkspace: vi.fn(async (type: WorkspaceType) => `${type}-mock-1`),
  activateWorkspace: vi.fn((id: string) => {
    workspaceStoreState.activeWorkspaceId = id;
  }),
}));

const featureFlagStoreState = vi.hoisted(() => ({
  multiViewBatch: false,
  setMultiViewBatchEnabled: vi.fn(),
  toggleMultiViewBatch: vi.fn(),
  integratedWorkspaceV1: false,
  setIntegratedWorkspaceV1Enabled: vi.fn(),
  toggleIntegratedWorkspaceV1: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => {
  type Selector<T> = (state: typeof workspaceStoreState) => T;
  const useWorkspaceStore = (<T,>(selector: Selector<T>) => selector(workspaceStoreState)) as {
    <T>(selector: Selector<T>): T;
    getState: () => typeof workspaceStoreState;
  };
  useWorkspaceStore.getState = () => workspaceStoreState;
  return { useWorkspaceStore };
});

vi.mock('@/stores/featureFlagStore', () => {
  type Selector<T> = (state: typeof featureFlagStoreState) => T;
  const useFeatureFlagStore = (<T,>(selector: Selector<T>) =>
    selector(featureFlagStoreState)) as {
    <T>(selector: Selector<T>): T;
    getState: () => typeof featureFlagStoreState;
  };
  useFeatureFlagStore.getState = () => featureFlagStoreState;
  return { useFeatureFlagStore };
});

import { DisplayModeSelector } from '../DisplayModeSelector';

function makeWorkspace(id: string, type: WorkspaceType): Workspace {
  return {
    id,
    type,
    title: id,
    presetId: null,
    timestamp: Date.now(),
    isActive: false,
    layoutConfig: { root: { type: 'component', componentType: 'EmptyView', title: id, componentState: {} } },
    panelStates: new Map(),
  };
}

function resetState() {
  workspaceStoreState.workspaces = new Map();
  workspaceStoreState.activeWorkspaceId = null;
  workspaceStoreState.createWorkspace.mockClear();
  workspaceStoreState.activateWorkspace.mockClear();
  featureFlagStoreState.integratedWorkspaceV1 = false;
}

describe('DisplayModeSelector', () => {
  beforeEach(() => {
    resetState();
  });

  it('renders pills for Orthogonal, Surface, Integrated, Mosaic, Compare in that order', () => {
    render(<DisplayModeSelector />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Orthogonal',
      'Surface',
      'Integrated',
      'Mosaic',
      'Compare',
    ]);
  });

  it('marks no pill active when there is no active workspace', () => {
    render(<DisplayModeSelector />);

    const selector = screen.getByTestId('display-mode-selector');
    expect(selector.getAttribute('data-active-mode')).toBe('');
    for (const id of ['orthogonal', 'surface', 'integrated', 'mosaic', 'compare']) {
      expect(screen.getByTestId(`display-mode-${id}`).getAttribute('data-active')).toBe('false');
    }
  });

  it('marks the orthogonal pill active when the active workspace is orthogonal-locked', () => {
    workspaceStoreState.workspaces.set('w-1', makeWorkspace('w-1', 'orthogonal-locked'));
    workspaceStoreState.activeWorkspaceId = 'w-1';

    render(<DisplayModeSelector />);

    expect(screen.getByTestId('display-mode-selector').getAttribute('data-active-mode')).toBe('orthogonal');
    expect(screen.getByTestId('display-mode-orthogonal').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('display-mode-mosaic').getAttribute('data-active')).toBe('false');
  });

  it('marks the orthogonal pill active for orthogonal-flexible workspaces too (both types belong to one mode)', () => {
    workspaceStoreState.workspaces.set('w-1', makeWorkspace('w-1', 'orthogonal-flexible'));
    workspaceStoreState.activeWorkspaceId = 'w-1';

    render(<DisplayModeSelector />);

    expect(screen.getByTestId('display-mode-orthogonal').getAttribute('data-active')).toBe('true');
  });

  it('marks no pill active when the active workspace is set-studio (intentionally unmapped)', () => {
    workspaceStoreState.workspaces.set('w-1', makeWorkspace('w-1', 'set-studio'));
    workspaceStoreState.activeWorkspaceId = 'w-1';

    render(<DisplayModeSelector />);

    expect(screen.getByTestId('display-mode-selector').getAttribute('data-active-mode')).toBe('');
  });

  it('disables the surface pill (no workspace mapping yet)', () => {
    render(<DisplayModeSelector />);

    const surfacePill = screen.getByTestId('display-mode-surface');
    expect(surfacePill.getAttribute('data-disabled')).toBe('true');
    expect(surfacePill.getAttribute('data-disabled-reason')).toBe('unmapped');
    expect(surfacePill).toBeDisabled();
  });

  it('disables the integrated pill when the integratedWorkspaceV1 flag is off', () => {
    featureFlagStoreState.integratedWorkspaceV1 = false;

    render(<DisplayModeSelector />);

    const integratedPill = screen.getByTestId('display-mode-integrated');
    expect(integratedPill.getAttribute('data-disabled')).toBe('true');
    expect(integratedPill.getAttribute('data-disabled-reason')).toBe('feature-flag');
    expect(integratedPill.getAttribute('title')).toMatch(/integratedWorkspaceV1/);
    expect(integratedPill).toBeDisabled();
  });

  it('enables the integrated pill when the integratedWorkspaceV1 flag is on', () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    const integratedPill = screen.getByTestId('display-mode-integrated');
    expect(integratedPill.getAttribute('data-disabled')).toBe('false');
    expect(integratedPill).not.toBeDisabled();
  });

  it('creates a new workspace when clicking a mode whose target type has no existing workspace', () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-mosaic'));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith('mosaic');
    expect(workspaceStoreState.activateWorkspace).not.toHaveBeenCalled();
  });

  it('activates the existing workspace instead of creating a new one when one of the target type already exists', () => {
    workspaceStoreState.workspaces.set('mosaic-existing', makeWorkspace('mosaic-existing', 'mosaic'));

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-mosaic'));

    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledWith('mosaic-existing');
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it('clicking the disabled surface pill is a no-op', () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-surface'));

    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
    expect(workspaceStoreState.activateWorkspace).not.toHaveBeenCalled();
  });

  it('clicking the disabled integrated pill (flag off) is a no-op', () => {
    featureFlagStoreState.integratedWorkspaceV1 = false;

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-integrated'));

    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
    expect(workspaceStoreState.activateWorkspace).not.toHaveBeenCalled();
  });

  it('creates an integrated workspace when the flag is on and clicked', () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-integrated'));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith('integrated');
  });

  it('targets the orthogonal-locked workspace type when the orthogonal pill is clicked from no-active-workspace', () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-orthogonal'));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith('orthogonal-locked');
  });

  it('activates an existing orthogonal-flexible workspace when Orthogonal is clicked (does not create a duplicate orthogonal-locked)', () => {
    // The app boots with `orthogonal-flexible` per GoldenLayoutRoot. Without
    // display-mode-equivalence search, a click on the Orthogonal pill from
    // Mosaic/Compare would have created a NEW `orthogonal-locked` workspace
    // instead of activating the existing one. This test pins that fix.
    workspaceStoreState.workspaces.set(
      'flex-existing',
      makeWorkspace('flex-existing', 'orthogonal-flexible'),
    );
    workspaceStoreState.workspaces.set('mosaic-existing', makeWorkspace('mosaic-existing', 'mosaic'));
    workspaceStoreState.activeWorkspaceId = 'mosaic-existing';

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-orthogonal'));

    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledWith('flex-existing');
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it('activates an existing orthogonal-locked workspace when Orthogonal is clicked', () => {
    workspaceStoreState.workspaces.set(
      'locked-existing',
      makeWorkspace('locked-existing', 'orthogonal-locked'),
    );

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId('display-mode-orthogonal'));

    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledWith('locked-existing');
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });
});
