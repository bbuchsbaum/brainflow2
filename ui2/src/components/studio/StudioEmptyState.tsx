import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { getSetStudioService, selectedStudioFolder } from '@/services/studio/SetStudioService';
import { PopulationOpenControls } from './PopulationOpenControls';
import React from 'react';
import { Button } from '@/components/ui/shadcn/button';

interface StudioEmptyStateProps {
  onImportTable: () => void;
  onImportManifest: () => void;
  onDiscoverFiles: () => void;
  onLoadDemo: () => void;
}

export function StudioEmptyState({
  onImportTable,
  onImportManifest,
  onDiscoverFiles,
  onLoadDemo,
}: StudioEmptyStateProps) {
  const entries = useFileBrowserStore((state) => state.entries);
  const selectedPath = useFileBrowserStore((state) => state.selectedPath);
  const folder = React.useMemo(
    () => selectedStudioFolder(entries, selectedPath),
    [entries, selectedPath],
  );
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-sm border border-border bg-card p-6 shadow-sm">
        <div className="text-bf-sm font-medium text-muted-foreground">Set Studio</div>
        <h1 className="mt-2 text-bf-lg font-semibold text-foreground">Open a set</h1>
        <p className="mt-2 text-bf-md leading-6 text-muted-foreground">
          Browse images together, organize members, and compare compatible data.
        </p>

        {folder && (
          <Button
            variant="outline"
            className="mt-4 max-w-full"
            title={folder.path}
            onClick={() =>
              void getSetStudioService().openFolderOntologyInStudio({ discoveryRoot: folder.path })
            }
          >
            <span className="truncate">Use selected folder: {folder.name}</span>
          </Button>
        )}
        <div className="mt-4">
          <PopulationOpenControls />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={onImportTable}>Import table…</Button>
          <Button variant="outline" onClick={onImportManifest}>
            Open NeuroTabs manifest…
          </Button>
          <Button variant="outline" onClick={onDiscoverFiles}>
            Choose a folder…
          </Button>
          <Button variant="ghost" onClick={onLoadDemo}>
            Try an example
          </Button>
        </div>
      </div>
    </div>
  );
}
