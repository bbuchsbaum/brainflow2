import { useSetStudioStore } from '@/stores/setStudioStore';
import { StudioFolderReview } from './StudioFolderReview';
import { getSetStudioService } from '@/services/studio/SetStudioService';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import { StudioAuditBanner } from './StudioAuditBanner';
import { StudioCenterPane } from './StudioCenterPane';
import { StudioEmptyState } from './StudioEmptyState';
import { StudioImportDialog } from './StudioImportDialog';
import { StudioToolbar } from './StudioToolbar';

export function SetStudioWorkspace() {
  const reviewingFolder = useSetStudioStore(
    (state) => state.importDialog.isOpen && !!state.importDialog.folderReview,
  );
  const studioService = getSetStudioService();
  const { activeSet, workspaceReadiness } = useStudioDerivedState();

  if (reviewingFolder) return <StudioFolderReview />;

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
            void studioService.openFolderOntologyInStudio();
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
          dataStateLabel={
            activeSet.savedPopulation
              ? 'Saved calculation'
              : activeSet.sourceKind === 'demo'
                ? 'Demo data'
                : 'Imported'
          }
        />
        <StudioAuditBanner activeSet={activeSet} readiness={workspaceReadiness} />

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <StudioCenterPane />
        </div>
      </div>
    </div>
  );
}
