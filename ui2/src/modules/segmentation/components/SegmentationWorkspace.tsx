/**
 * The Segmentation tool tab while the module is in design: it says plainly
 * that editing is not available. It does not load the design mocks.
 */

import React from 'react';
import { EmptyPane } from '@/components/ui/bf';

export function SegmentationWorkspace() {
  return (
    <div className="h-full w-full bg-bf-bg-panel">
      <EmptyPane
        title="Segmentation is in design"
        hint="Label tracing, locks and proposals are being designed. Editing is not available in this build."
      />
    </div>
  );
}
