/** Persisted design-era tool tabs migrate to a clear entry into view modes. */
import React from 'react';
import { EmptyPane } from '@/components/ui/bf';
export function SegmentationWorkspace({ workspaceId }: { workspaceId: string }) {
  return <EmptyPane data-workspace-id={workspaceId} title="Open Segment in a view tab" hint="Select a loaded image in a view tab, then choose Open segmentation. Tracing now belongs to that view." />;
}
