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

import React from 'react';

import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceType } from '@/types/workspace';

import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { OrthogonalPanelsWorkspace } from '@/components/views/OrthogonalPanelsWorkspace';
import { MosaicViewPromise } from '@/components/views/MosaicViewPromise';
import { SetStudioWorkspace } from '@/components/studio/SetStudioWorkspace';
import { ComparisonWorkspace } from '@/components/views/ComparisonWorkspace';
import { BidsExplorerWorkspace } from '@/components/bids/BidsExplorerWorkspace';
import { AnalysisWorkbenchWorkspace } from '@/components/analysis/AnalysisWorkbenchWorkspace';
import { IntegratedVolumeSurfaceWorkspace } from '@/components/views/IntegratedVolumeSurfaceWorkspace';

export interface WorkspaceRouterProps {
  workspaceId: string;
  workspaceType: WorkspaceType;
}

export const WorkspaceRouter: React.FC<WorkspaceRouterProps> = ({ workspaceId, workspaceType }) => {
  const workspace = useWorkspaceStore((state) => state.workspaces.get(workspaceId));
  const integratedWorkspaceEnabled = useFeatureFlagStore((state) => state.integratedWorkspaceV1);

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

  switch (workspaceType) {
    case 'orthogonal-locked':
      return <OrthogonalViewContainer />;
    case 'orthogonal-flexible':
      return <OrthogonalPanelsWorkspace />;
    case 'mosaic':
      return <MosaicViewPromise workspaceId={workspaceId} />;
    case 'comparison':
      return <ComparisonWorkspace workspaceId={workspaceId} />;
    case 'integrated':
      if (!integratedWorkspaceEnabled) {
        return (
          <div
            data-testid="integrated-workspace-flag-disabled"
            className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 px-4 text-center"
          >
            <span className="text-sm font-medium">Integrated workspace is disabled.</span>
            <span className="text-xs opacity-70 max-w-prose">
              Enable the <code>integratedWorkspaceV1</code> feature flag to use this workspace.
            </span>
          </div>
        );
      }
      return <IntegratedVolumeSurfaceWorkspace />;
    case 'set-studio':
      return <SetStudioWorkspace />;
    case 'bids-explorer':
      return <BidsExplorerWorkspace workspaceId={workspaceId} />;
    case 'analysis-workbench':
      return <AnalysisWorkbenchWorkspace workspaceId={workspaceId} />;
    default:
      return (
        <div
          data-testid="workspace-router-unknown"
          className="h-full flex items-center justify-center text-muted-foreground"
        >
          Unknown workspace type: {workspaceType}
        </div>
      );
  }
};

export default WorkspaceRouter;
