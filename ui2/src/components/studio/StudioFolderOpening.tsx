import { useEffect } from 'react';
import { EmptyPane } from '@/components/ui/bf';
import { folderSetName } from '@/services/studio/folderOpenDecision';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';

/**
 * A folder being opened as a set in one step. While its scan runs it is not
 * known whether it needs its review, so the Studio says only that it is
 * opening, and what the scan is doing. A folder with nothing to decide then
 * opens in the Deck; any other shows its review, already scanned. The
 * current study is untouched until then, and Cancel leaves it as it was.
 */
export function StudioFolderOpening({ root }: { root: string }) {
  const service = getSetIngestionService();
  // The scan is this view's: leaving the Studio panel cancels it, as for the review.
  useEffect(() => service.retainFolderReview(), [service]);
  const finding = useSetStudioStore((state) => state.importDialog.isOntologyLoading);
  return (
    <section
      aria-label="Opening set"
      aria-busy
      role="status"
      data-testid="studio-folder-opening"
      className="h-full bg-background p-6 text-foreground"
    >
      <EmptyPane
        title={`Opening ${folderSetName(root) ?? 'folder'}`}
        hint={
          <>
            <span className="block">{finding ? 'Finding images…' : 'Checking organization…'}</span>
            <span
              role="progressbar"
              aria-label="Opening progress"
              className="mx-auto mt-3 block h-0.5 w-48 max-w-full overflow-hidden bg-bf-border-subtle"
            >
              <span className="block h-full w-full animate-pulse bg-primary" />
            </span>
          </>
        }
        secondary={{ label: 'Cancel', onClick: () => service.cancelReview() }}
      />
    </section>
  );
}
