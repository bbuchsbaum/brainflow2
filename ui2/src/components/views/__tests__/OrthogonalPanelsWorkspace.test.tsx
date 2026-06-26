/**
 * OrthogonalPanelsWorkspace — arrangement layout + draggable resize gutters +
 * menu gating.
 *
 * FlexibleSlicePanel and the arrangement menu are stubbed; the real
 * ResizableOrthoGrid renders, so each arrangement shows the three slices plus
 * its draggable resize gutters (`ortho-gutter-*`).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../FlexibleSlicePanel', () => ({
  FlexibleSlicePanel: ({ viewId }: { viewId: string }) => (
    <div data-testid={`slice-${viewId}`}>{viewId}</div>
  ),
}));

vi.mock('@/components/ui/ArrangementMenu', () => ({
  ArrangementMenu: () => <div data-testid="arrangement-menu-stub" />,
}));

import { OrthogonalPanelsWorkspace } from '../OrthogonalPanelsWorkspace';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

function expectAllThreeSlices() {
  expect(screen.getByTestId('slice-axial')).toBeInTheDocument();
  expect(screen.getByTestId('slice-sagittal')).toBeInTheDocument();
  expect(screen.getByTestId('slice-coronal')).toBeInTheDocument();
}

describe('OrthogonalPanelsWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it('renders the grid arrangement by default, with the corner menu and resize gutters', () => {
    const { container } = render(<OrthogonalPanelsWorkspace />);
    expectAllThreeSlices();
    expect(screen.getByTestId('arrangement-menu-stub')).toBeInTheDocument();
    // grid arrangement has a row gutter (axial / bottom) and a column gutter (sag | cor).
    expect(screen.getByTestId('ortho-gutter-grid-row')).toBeInTheDocument();
    expect(screen.getByTestId('ortho-gutter-grid-col')).toBeInTheDocument();
    // No Allotment splitter is used anywhere.
    expect(container.querySelector('.split-view')).toBeNull();
  });

  it('lays out a horizontal row with two draggable gutters when arrangement=row', () => {
    useLayoutSettingsStore.getState().setOrthoArrangement('row');
    render(<OrthogonalPanelsWorkspace />);
    expectAllThreeSlices();
    expect(screen.getByTestId('ortho-gutter-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('ortho-gutter-row-1')).toBeInTheDocument();
  });

  it('lays out a vertical column with two draggable gutters when arrangement=column', () => {
    useLayoutSettingsStore.getState().setOrthoArrangement('column');
    render(<OrthogonalPanelsWorkspace />);
    expectAllThreeSlices();
    expect(screen.getByTestId('ortho-gutter-col-0')).toBeInTheDocument();
    expect(screen.getByTestId('ortho-gutter-col-1')).toBeInTheDocument();
  });

  it('suppresses its own menu when showArrangementMenu is false', () => {
    render(<OrthogonalPanelsWorkspace showArrangementMenu={false} />);
    expect(screen.queryByTestId('arrangement-menu-stub')).toBeNull();
    expect(screen.getByTestId('slice-axial')).toBeInTheDocument();
  });
});
