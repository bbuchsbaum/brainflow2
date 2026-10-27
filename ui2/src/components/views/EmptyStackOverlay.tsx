/**
 * The orthogonal stack's empty state (P3.11): ONE empty surface over the
 * whole stack, with no pane dividers or plane labels showing through the
 * message. The panes stay mounted underneath (no GPU remount on first load),
 * and drops still reach them: only the buttons take the pointer.
 */
import { EmptyPane } from '@/components/ui/bf';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import {
  openFileDialog,
  openFileShortcut,
  mountDirectoryDialog,
  mountDirectoryShortcut,
} from '@/services/fileActions';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';

export function EmptyStackOverlay() {
  const hasVolume = useViewStateStore((s) => s.viewState.layers.some((l) => !!l.volumeId));
  const loading = useLayerStore((s) => s.loadingLayers.size > 0);
  // The hint names what the user can do now: nothing is in Files until a
  // directory is mounted (v5 function critic).
  const mounted = useFileBrowserStore((s) => s.rootPath.trim().length > 0 || s.entries.length > 0);
  if (hasVolume || loading) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] bg-bf-bg-canvas [&_button]:pointer-events-auto"
      data-testid="orthogonal-empty"
    >
      <EmptyPane
        title="No volume loaded"
        hint={
          mounted
            ? 'Double-click a file in Files, or drop one on a view.'
            : 'Open a file, or mount a directory to browse it in Files.'
        }
        primary={{
          label: 'Open file…',
          onClick: () => void openFileDialog(),
          shortcut: openFileShortcut(),
          testId: 'empty-open-file',
        }}
        secondary={{
          label: 'Mount directory',
          onClick: () => void mountDirectoryDialog(),
          shortcut: mountDirectoryShortcut(),
          testId: 'empty-mount-directory',
        }}
      />
    </div>
  );
}
