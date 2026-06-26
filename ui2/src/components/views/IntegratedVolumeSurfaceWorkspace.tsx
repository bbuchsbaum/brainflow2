/**
 * IntegratedVolumeSurfaceWorkspace — the Integrated center display mode.
 *
 * Composes the orthogonal volume panels with the surface view panel. The
 * bottom Activity | Plot | Log dock is NOT owned here — it is supplied
 * shell-level by `CenterWithBottomDock` (which wraps every imaging mode), so
 * Integrated is purely the ortho + surface center layout.
 *
 * Arrangement is configurable from the corner `ArrangementMenu`:
 *   - `integratedSplit` flips the volume/surface split between side-by-side
 *     (horizontal) and stacked (vertical: volumes on top, surface below);
 *   - `orthoArrangement` (driven by the same menu) controls how the three
 *     slices are laid out inside the volume region. The embedded
 *     `OrthogonalPanelsWorkspace` reads that arrangement from the store, so its
 *     own menu is suppressed here (this workspace renders the combined one).
 *
 * Top-pinned time row appears only when the active layer is a 4D volume
 * (`PinnedTimeRow` self-gates and returns null for 3D layers; the surrounding
 * Allotment.Pane is also elided so the row contributes zero vertical space).
 */

import React from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

import { ArrangementMenu } from '@/components/ui/ArrangementMenu';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

import { OrthogonalPanelsWorkspace } from './OrthogonalPanelsWorkspace';
import { SurfaceViewPanel } from './SurfaceViewPanelLazy';
import { SurfaceAssociationBadge } from './SurfaceAssociationBadge';
import { PinnedTimeRow } from './PinnedTimeRow';
import { useActiveLayerIsFourD } from './pinnedTimeRow.helpers';

const PINNED_ROW_PREFERRED_PX = 96;
const PINNED_ROW_MIN_PX = 64;

export const IntegratedVolumeSurfaceWorkspace: React.FC = () => {
  const isFourD = useActiveLayerIsFourD();
  const split = useLayoutSettingsStore((s) => s.integratedSplit);

  // The inner split's minSize constrains the cross-axis it's laid out on: width
  // when side-by-side, height when stacked. A short center can't fit two 240px
  // *heights* — Allotment then collapses a pane and paints it black — so use a
  // smaller floor when stacked. The Allotment sash still lets the user resize.
  const innerPaneMinSize = split === 'vertical' ? 120 : 240;

  return (
    <div
      data-testid="integrated-volume-surface-workspace"
      data-pinned-time-row={isFourD ? 'true' : 'false'}
      data-split={split}
      className="bf-integrated-workspace"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--app-bg-primary)',
        color: 'var(--app-text-primary)',
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <Allotment vertical proportionalLayout>
          {isFourD ? (
            <Allotment.Pane
              key="pinned-time-row"
              preferredSize={PINNED_ROW_PREFERRED_PX}
              minSize={PINNED_ROW_MIN_PX}
              snap
            >
              <PinnedTimeRow />
            </Allotment.Pane>
          ) : null}

          <Allotment.Pane key="primary-views" minSize={200}>
            {/* key by split: Allotment keeps pane sizes in px, so flipping the
                direction would otherwise apply the old cross-axis sizes to the
                new axis (e.g. ~310px widths become heights and overflow a short
                center → collapsed-to-black panes). Remounting re-lays-out fresh. */}
            <Allotment key={split} vertical={split === 'vertical'} proportionalLayout>
              <Allotment.Pane minSize={innerPaneMinSize}>
                <div
                  data-testid="integrated-workspace-orthogonal-region"
                  style={{ height: '100%', width: '100%' }}
                >
                  <OrthogonalPanelsWorkspace showArrangementMenu={false} />
                </div>
              </Allotment.Pane>
              <Allotment.Pane minSize={innerPaneMinSize}>
                <div
                  data-testid="integrated-workspace-surface-region"
                  style={{
                    position: 'relative',
                    height: '100%',
                    width: '100%',
                  }}
                >
                  {/* Offset the panel's metadata card below the top-left
                      association badge so the two don't overlap. */}
                  <SurfaceViewPanel infoOverlayTop="2.75rem" />
                  <SurfaceAssociationBadge />
                </div>
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }}>
        <ArrangementMenu showSplit />
      </div>
    </div>
  );
};

export default IntegratedVolumeSurfaceWorkspace;
