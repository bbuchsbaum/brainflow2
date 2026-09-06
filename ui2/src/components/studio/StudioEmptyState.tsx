import { PopulationOpenControls } from './PopulationOpenControls';
import React from 'react';
import { Button } from '@/components/ui/Button';

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
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="text-xs font-medium text-muted-foreground">Set Studio</div>
        <h1 className="mt-2 text-xl font-semibold text-foreground">No study loaded</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Import a table, manifest, or discovered file set to start browsing members and comparing
          groups.
        </p>

        <div className="mt-4">
          <PopulationOpenControls />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={onImportTable}>Import Table (TSV/CSV)</Button>
          <Button variant="secondary" onClick={onImportManifest}>
            NeuroTabs Manifest
          </Button>
          <Button variant="secondary" onClick={onDiscoverFiles}>
            Discover Files
          </Button>
          <Button variant="ghost" onClick={onLoadDemo}>
            Load Demo
          </Button>
        </div>
      </div>
    </div>
  );
}
