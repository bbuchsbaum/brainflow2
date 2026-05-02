import React from 'react';

/**
 * Placeholder Analysis Workbench Inspector. Will eventually carry analysis
 * job parameters, run controls, output bindings, and provenance for the
 * active analysis. Kept inert for the right-rail unification work.
 */
export function AnalysisInspector() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center text-[12px] text-muted-foreground">
      <div className="text-foreground">No analysis selected</div>
      <div className="text-[11px] text-muted-foreground/80">
        Choose an analysis in the workbench to see parameters and outputs here.
      </div>
    </div>
  );
}
