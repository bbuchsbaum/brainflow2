/**
 * WorkspaceRouter — extracted from GoldenLayoutRoot for testability.
 *
 * Routes the workspace `type` to the corresponding root component. Owns:
 *   - the `'integrated'` feature-flag gate (renders a notice when
 *     `integratedWorkspaceV1` is off);
 *   - the not-found / unknown-type fallbacks.
 *
 * Mounted by `GoldenLayoutRoot` inside each tab's React root via
 * `goldenLayout.registerComponent('Workspace', …)`. Tests cover the route
 * table and the integrated flag-gate without spinning up GoldenLayout.
 */

import React from "react";

import { useFeatureFlagStore } from "@/stores/featureFlagStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceType } from "@/types/workspace";

import { OrthogonalViewContainer } from "@/components/views/OrthogonalViewContainer";
import { OrthogonalPanelsWorkspace } from "@/components/views/OrthogonalPanelsWorkspace";
import { MosaicViewPromise } from "@/components/views/MosaicViewPromise";
import { SetStudioWorkspace } from "@/components/studio/SetStudioWorkspace";
import { ComparisonWorkspace } from "@/components/views/ComparisonWorkspace";
import { BidsExplorerWorkspace } from "@/components/bids/BidsExplorerWorkspace";
import { AnalysisWorkbenchWorkspace } from "@/components/analysis/AnalysisWorkbenchWorkspace";
import { IntegratedVolumeSurfaceWorkspace } from "@/components/views/IntegratedVolumeSurfaceWorkspace";
import { CenterWithPlotDock } from "@/components/layout/CenterWithPlotDock";

export interface WorkspaceRouterProps {
  workspaceId: string;
  workspaceType: WorkspaceType;
}

export const WorkspaceRouter: React.FC<WorkspaceRouterProps> = ({
  workspaceId,
  workspaceType,
}) => {
  const workspace = useWorkspaceStore((state) =>
    state.workspaces.get(workspaceId),
  );
  const integratedWorkspaceEnabled = useFeatureFlagStore(
    (state) => state.integratedWorkspaceV1,
  );

  if (!workspace) {
    return (
      <div
        data-testid="workspace-router-not-found"
        className="h-full flex items-center justify-center text-muted-foreground"
      >
        Workspace not found
      </div>
    );
  }

  // Route on the LIVE store type, not the initial componentState prop, so the
  // top-bar mode pills can reconfigure this tab's mode in place (they mutate
  // `workspace.type`, which re-renders this subscribed component). The prop is
  // only a defensive fallback for the very first render.
  const routeType: WorkspaceType = workspace.type ?? workspaceType;

  switch (routeType) {
    // The imaging workspaces share the collapsible bottom PlotDock, scoped to
    // the center column via CenterWithPlotDock (which gives the view pane a
    // definite pixel height via absolute insets, so each view's height:100% +
    // ResizeObserver sizing — orthogonal, mosaic, comparison — resolves and
    // reflows cleanly when the dock opens/resizes). The dock's pane-resize also
    // fed the viewStateStore resize fallback, which left-anchored slices; fixed
    // there (fallback now uses the volume-bbox dim_px). The integrated
    // workspace composes its own full BottomWorkbenchDock and is excluded.
    case "orthogonal-locked":
      return (
        <CenterWithPlotDock>
          <OrthogonalViewContainer />
        </CenterWithPlotDock>
      );
    case "orthogonal-flexible":
      return (
        <CenterWithPlotDock>
          <OrthogonalPanelsWorkspace />
        </CenterWithPlotDock>
      );
    case "mosaic":
      return (
        <CenterWithPlotDock>
          <MosaicViewPromise workspaceId={workspaceId} />
        </CenterWithPlotDock>
      );
    case "comparison":
      return (
        <CenterWithPlotDock>
          <ComparisonWorkspace workspaceId={workspaceId} />
        </CenterWithPlotDock>
      );
    case "integrated":
      if (!integratedWorkspaceEnabled) {
        return (
          <div
            data-testid="integrated-workspace-flag-disabled"
            className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 px-4 text-center"
          >
            <span className="text-sm font-medium">
              Integrated workspace is disabled.
            </span>
            <span className="text-xs opacity-70 max-w-prose">
              Enable the <code>integratedWorkspaceV1</code> feature flag to use
              this workspace.
            </span>
          </div>
        );
      }
      return <IntegratedVolumeSurfaceWorkspace />;
    case "set-studio":
      return <SetStudioWorkspace />;
    case "bids-explorer":
      return <BidsExplorerWorkspace workspaceId={workspaceId} />;
    case "analysis-workbench":
      return <AnalysisWorkbenchWorkspace workspaceId={workspaceId} />;
    default:
      return (
        <div
          data-testid="workspace-router-unknown"
          className="h-full flex items-center justify-center text-muted-foreground"
        >
          Unknown workspace type: {routeType}
        </div>
      );
  }
};

export default WorkspaceRouter;
