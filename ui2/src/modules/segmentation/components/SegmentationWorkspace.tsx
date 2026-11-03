/** Persisted design-era tool tabs migrate to a clear entry into view modes. */
import React, { useState } from 'react';
import { EmptyPane } from '@/components/ui/bf';
import { formatModuleError, runModuleCommand } from '@/modules/api/host';
export function SegmentationWorkspace({ workspaceId }: { workspaceId: string }) {
  const [error, setError] = useState<string | null>(null);
  // The same flow as ⌘K › Open segmentation: Segment mode in a view tab.
  const open = () => { setError(null); void runModuleCommand('segmentation.open').catch((failure: unknown) => setError(formatModuleError(failure))); };
  return <EmptyPane data-workspace-id={workspaceId} title="Segment in a view tab"
    hint={<>Tracing happens in Segment mode of a view tab. Load a reference image in a view, then open segmentation here or with <span className="font-mono">⌘K › Open segmentation</span>.{error ? <span role="alert" className="mt-1 block text-bf-warning">{error}</span> : null}</>}
    primary={{ label: 'Open segmentation', onClick: open, testId: 'segmentation-open' }} />;
}
