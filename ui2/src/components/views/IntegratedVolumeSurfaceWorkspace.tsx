/**
 * IntegratedVolumeSurfaceWorkspace — Phase 5a of the integrated workspace refactor.
 *
 * Composes the existing volume orthogonal panels and surface view panel with
 * the Phase 3 bottom dock and the Phase 4 plot host. The shell does NOT
 * modify the internals of those building blocks — it only arranges them and
 * provides inert placeholders for the Activity and Log slots that future
 * motes will fill in.
 *
 * Top-pinned time row appears only when the active layer is a 4D volume
 * (`PinnedTimeRow` self-gates and returns null for 3D layers; the surrounding
 * Allotment.Pane is also elided so the row contributes zero vertical space).
 *
 * Persistence (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`): the bottom dock's
 * pane sizes, log-collapsed flag, and plot-maximized flag round-trip
 * through `useLayoutSettingsStore`, so a refresh keeps the user's last
 * dock layout.
 */

import React from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

import { BottomWorkbenchDock } from '@/components/layout/BottomWorkbenchDock';
import type { DockSizes } from '@/components/layout/bottomWorkbenchDock.constants';
import { ActivityPanel } from '@/components/panels/ActivityPanel';
import { LogPanel } from '@/components/panels/LogPanel';
import { PlotPanel } from '@/components/panels/PlotPanel';
import { InspectorAnnotatePanel } from '@/components/panels/InspectorAnnotatePanel';
import { useDefaultPlotModeForActiveLayer } from '@/components/plots/plotMode.helpers';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

import { OrthogonalPanelsWorkspace } from './OrthogonalPanelsWorkspace';
import { SurfaceViewPanel } from './SurfaceViewPanel';
import { SurfaceAssociationBadge } from './SurfaceAssociationBadge';
import { PinnedTimeRow } from './PinnedTimeRow';
import { useActiveLayerIsFourD } from './pinnedTimeRow.helpers';

const PINNED_ROW_PREFERRED_PX = 96;
const PINNED_ROW_MIN_PX = 64;
const DOCK_PREFERRED_PX = 240;
const DOCK_MIN_PX = 120;
const INSPECTOR_PREFERRED_PX = 280;
const INSPECTOR_MIN_PX = 200;

export const IntegratedVolumeSurfaceWorkspace: React.FC = () => {
  const isFourD = useActiveLayerIsFourD();
  const defaultPlotMode = useDefaultPlotModeForActiveLayer();

  const dockSizes = useLayoutSettingsStore((s) => s.bottomDockSizes);
  const dockLogCollapsed = useLayoutSettingsStore((s) => s.bottomDockLogCollapsed);
  const dockPlotMaximized = useLayoutSettingsStore((s) => s.bottomDockPlotMaximized);
  const setDockSizes = useLayoutSettingsStore((s) => s.setBottomDockSizes);
  const setDockLogCollapsed = useLayoutSettingsStore((s) => s.setBottomDockLogCollapsed);
  const setDockPlotMaximized = useLayoutSettingsStore((s) => s.setBottomDockPlotMaximized);

  const handleDockSizesChange = React.useCallback(
    (sizes: DockSizes) => setDockSizes(sizes),
    [setDockSizes],
  );

  return (
    <div
      data-testid="integrated-volume-surface-workspace"
      data-pinned-time-row={isFourD ? 'true' : 'false'}
      className="bf-integrated-workspace"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--app-bg-primary)',
        color: 'var(--app-text-primary)',
      }}
    >
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
          <Allotment proportionalLayout>
            <Allotment.Pane minSize={240}>
              <div data-testid="integrated-workspace-orthogonal-region" style={{ height: '100%', width: '100%' }}>
                <OrthogonalPanelsWorkspace />
              </div>
            </Allotment.Pane>
            <Allotment.Pane minSize={240}>
              <div
                data-testid="integrated-workspace-surface-region"
                style={{ position: 'relative', height: '100%', width: '100%' }}
              >
                <SurfaceViewPanel />
                <SurfaceAssociationBadge />
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={INSPECTOR_PREFERRED_PX} minSize={INSPECTOR_MIN_PX} snap>
              <div data-testid="integrated-workspace-inspector-region" style={{ height: '100%', width: '100%' }}>
                <InspectorAnnotatePanel />
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane
          key="bottom-dock"
          preferredSize={DOCK_PREFERRED_PX}
          minSize={DOCK_MIN_PX}
          snap
        >
          <BottomWorkbenchDock
            plot={<PlotPanel defaultMode={defaultPlotMode} />}
            activity={<ActivityPanel />}
            log={<LogPanel />}
            defaultSizes={dockSizes ?? undefined}
            onSizesChange={handleDockSizesChange}
            defaultLogCollapsed={dockLogCollapsed}
            onLogCollapsedChange={setDockLogCollapsed}
            defaultPlotMaximized={dockPlotMaximized}
            onPlotMaximizedChange={setDockPlotMaximized}
          />
        </Allotment.Pane>
      </Allotment>
    </div>
  );
};

export default IntegratedVolumeSurfaceWorkspace;
