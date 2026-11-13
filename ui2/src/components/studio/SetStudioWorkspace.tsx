import { useSetStudioStore } from '@/stores/setStudioStore';
import { StudioFolderReview } from './StudioFolderReview';
import { StudioFolderOpening } from './StudioFolderOpening';
import { getSetStudioService } from '@/services/studio/SetStudioService';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import { StudioCenterPane } from './StudioCenterPane';
import { StudioEmptyState } from './StudioEmptyState';
import { StudioImportDialog } from './StudioImportDialog';
import { StudioOpenNotice } from './StudioOpenNotice';

export function SetStudioWorkspace() {
  const reviewingFolder = useSetStudioStore(
    (state) => state.importDialog.isOpen && !!state.importDialog.folderReview,
  );
  // A folder being opened in one step: until its scan says whether it needs
  // a review, say that it is opening instead of showing the review form.
  const openingFolder = useSetStudioStore((state) =>
    state.studioFolderOpening !== null &&
    state.studioFolderOpening === state.importDialog.discoveryRoot &&
    !state.importDialog.error &&
    !state.importDialog.ontologyError
      ? state.studioFolderOpening
      : null,
  );
  const studioService = getSetStudioService();
  const { activeSet } = useStudioDerivedState();

  if (reviewingFolder && openingFolder) return <StudioFolderOpening root={openingFolder} />;
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
        {/* The set's name, status and facts are on the Studio's lens row (StudioCenterPane). */}
        <StudioOpenNotice />
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <StudioCenterPane />
        </div>
      </div>
    </div>
  );
}
