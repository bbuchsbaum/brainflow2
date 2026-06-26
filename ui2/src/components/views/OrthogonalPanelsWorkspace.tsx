/**
 * OrthogonalPanelsWorkspace
 *
 * Three linked anatomical views (axial, sagittal, coronal) laid out with CSS
 * grid — the same primitive the non-integrated OrthogonalViewContainer uses,
 * which sizes/centers each slice reliably. The arrangement (grid / row / column,
 * from `layoutSettingsStore.orthoArrangement`) is toggled from the corner
 * `ArrangementMenu`.
 *
 * All three arrangements share a FLAT three-child structure (only the grid
 * template and axial's span differ), so switching arrangements just changes
 * CSS — React preserves the three FlexibleSlicePanel instances, each panel's
 * ResizeObserver fires on its cell-size change, and the backend re-fits the
 * slice centered to the new cell (`updateDimensionsAndPreserveScale`). That
 * avoids the Allotment pane-collapse (which painted `row` black) and the stale
 * pane sizes that clipped slices when switching arrangements.
 */

import { type ReactNode } from 'react';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { ResizableOrthoGrid } from './ResizableOrthoGrid';
import { ArrangementMenu } from '@/components/ui/ArrangementMenu';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import './OrthogonalPanelsWorkspace.css';

interface OrthogonalPanelsWorkspaceProps {
  /** Render the corner arrangement menu. Default true. The Integrated
   *  workspace renders its own (with the split toggle) and passes false. */
  showArrangementMenu?: boolean;
}

export function OrthogonalPanelsWorkspace({
  showArrangementMenu = true,
}: OrthogonalPanelsWorkspaceProps = {}) {
  const arrangement = useLayoutSettingsStore((s) => s.orthoArrangement);

  // Resizable grid with draggable gutters between panes. The three panels stay
  // stably keyed across arrangement changes (no GPU-panel remounts); only grid
  // placement + track sizes change. See ResizableOrthoGrid.
  const tree: ReactNode = (
    <ResizableOrthoGrid
      arrangement={arrangement}
      axial={<FlexibleSlicePanel viewId="axial" title="Axial" />}
      sagittal={<FlexibleSlicePanel viewId="sagittal" title="Sagittal" />}
      coronal={<FlexibleSlicePanel viewId="coronal" title="Coronal" />}
    />
  );

  return (
    <div
      className="bg-black split-view-container"
      style={{ position: 'relative', height: '100%', width: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>{tree}</div>
      {showArrangementMenu && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }}>
          <ArrangementMenu />
        </div>
      )}
    </div>
  );
}
