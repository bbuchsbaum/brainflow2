import { getSetStudioService } from '@/services/studio/SetStudioService';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import { StudioCenterPane } from './StudioCenterPane';
import { StudioEmptyState } from './StudioEmptyState';
import { StudioImportDialog } from './StudioImportDialog';
import { StudioToolbar } from './StudioToolbar';

interface SetStudioWorkspaceProps {
  containerWidth?: number;
  containerHeight?: number;
}

export function SetStudioWorkspace({
  containerWidth: _containerWidth,
  containerHeight: _containerHeight,
}: SetStudioWorkspaceProps) {
  const studioService = getSetStudioService();
  const { activeSet, activeFeature, activeLens, compareCohort, workspaceReadiness } =
    useStudioDerivedState();

  if (!activeSet) {
    return (
      <div className="h-full overflow-hidden bg-background text-foreground">
        <StudioImportDialog />
        <StudioEmptyState
          onImportTable={() => {
            void studioService.openTableImportInStudio();
          }}
          onImportManifest={() => {
            void studioService.openManifestInStudio();
          }}
          onDiscoverFiles={() => {
            void studioService.openRegexDiscoveryInStudio();
          }}
          onLoadDemo={() => {
            void studioService.openDemoInStudio();
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-background text-foreground">
      <div className="flex h-full flex-col">
        <StudioImportDialog />
        <StudioToolbar
          setName={activeSet.name}
          dataStateLabel={activeSet.sourceKind === 'demo' ? 'Demo data' : 'Imported'}
        />
        {workspaceReadiness ? (
          <div className={`mx-3 mt-3 rounded-lg border px-4 py-3 ${workspaceReadiness.className}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium">{workspaceReadiness.eyebrow}</div>
                <div className="mt-1 text-sm font-medium">{workspaceReadiness.title}</div>
                <div className="mt-1 text-sm">{workspaceReadiness.message}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <StudioCenterPane />
        </div>
      </div>
    </div>
  );
}
