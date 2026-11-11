import { X } from 'lucide-react';
import { Button, Notice } from '@/components/ui/bf';
import { IconButton } from '@/components/ui/IconButton';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';

/**
 * One quiet line under the Studio header after a folder was opened as a set
 * without its review: what was opened, and the way to the review. It stays
 * until dismissed or another set is opened.
 */
export function StudioOpenNotice() {
  const notice = useSetStudioStore((state) =>
    state.studioOpenNotice && state.studioOpenNotice.setId === state.selection.activeSetId
      ? state.studioOpenNotice
      : null,
  );
  if (!notice) return null;
  return (
    <Notice
      severity="neutral"
      icon={false}
      className="items-center border-b border-border px-3 py-1"
      data-testid="studio-open-notice"
      action={
        <span className="flex items-center gap-1">
          <Button
            variant="link"
            size="sm"
            className="min-h-6"
            onClick={() => void getSetIngestionService().reviewOpenedFolder()}
          >
            Review…
          </Button>
          <IconButton
            size="xs"
            variant="ghost"
            icon={<X />}
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => useSetStudioStore.getState().setStudioOpenNotice(null)}
          />
        </span>
      }
    >
      {notice.message}
    </Notice>
  );
}
