import React, { useMemo } from 'react';
import { useAnalysisStore } from '@/stores/analysisStore';
import { InspectorSection, FieldRow } from '../imaging/InspectorSection';
import { JobStatusPill } from '@/components/analysis/JobStatusPill';

/**
 * Analysis workbench Inspector. Follows the workbench selection
 * (`analysisStore.selectedAnalysisId`) and summarises the selected analysis:
 * its contract (inputs, outputs, runner) and its most recent job. Parameter
 * editing and launch stay in the workbench, which is their single editable
 * home; this view is read-only.
 */
export function AnalysisInspector() {
  // Stable selectors: primitives or references that already live in the store.
  const selectedId = useAnalysisStore((state) => state.selectedAnalysisId);
  const descriptors = useAnalysisStore((state) => state.descriptors);
  const jobs = useAnalysisStore((state) => state.jobs);

  const descriptor = useMemo(
    () => (selectedId ? (descriptors.find((d) => d.id === selectedId) ?? null) : null),
    [descriptors, selectedId],
  );
  // `jobs` is kept newest-first by the store's upsert.
  const latestJob = useMemo(
    () => (selectedId ? (jobs.find((job) => job.analysis_id === selectedId) ?? null) : null),
    [jobs, selectedId],
  );

  if (!descriptor) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center text-bf-sm text-muted-foreground">
        <div className="text-foreground">No analysis selected</div>
        <div className="text-bf-xs text-muted-foreground">
          Choose an analysis in the workbench to see parameters and outputs here.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="analysis-inspector">
      <header className="border-y border-border/60 bg-card/40 px-3 py-2.5">
        <div className="text-bf-2xs font-semibold text-muted-foreground">Selected analysis</div>
        <div
          className="mt-0.5 truncate text-bf-lg font-semibold text-foreground"
          title={descriptor.name}
        >
          {descriptor.name}
        </div>
        <div
          className="mt-0.5 truncate font-mono text-bf-xs text-muted-foreground"
          title={descriptor.id}
        >
          {descriptor.id} · v{descriptor.version}
        </div>
      </header>

      {descriptor.description ? (
        <p className="px-3 py-2 text-bf-xs text-bf-text-secondary">{descriptor.description}</p>
      ) : null}

      <InspectorSection label="Contract" defaultOpen>
        <FieldRow label="Inputs">
          <span className="text-foreground">{formatList(descriptor.inputs)}</span>
        </FieldRow>
        <FieldRow label="Outputs">
          <span className="text-foreground">{formatList(descriptor.outputs)}</span>
        </FieldRow>
        <FieldRow label="Runner">
          <span className="text-foreground">{descriptor.runner.type}</span>
        </FieldRow>
      </InspectorSection>

      <InspectorSection label="Last job" defaultOpen>
        {latestJob ? (
          <>
            <FieldRow label="Job">
              <span className="font-mono tabular-nums text-foreground">{latestJob.job_id}</span>
            </FieldRow>
            <FieldRow label="State">
              <JobStatusPill state={latestJob.state} />
            </FieldRow>
            {latestJob.progress !== null ? (
              <FieldRow label="Progress">
                <span className="font-mono tabular-nums text-foreground">
                  {Math.round(latestJob.progress * 100)}%
                </span>
              </FieldRow>
            ) : null}
            <FieldRow label="Artifacts">
              <span className="font-mono tabular-nums text-foreground">
                {latestJob.artifacts?.length ?? 0}
              </span>
            </FieldRow>
            {latestJob.error ? (
              <p className="py-1 text-bf-xs text-bf-danger [overflow-wrap:anywhere]">
                {latestJob.error}
              </p>
            ) : null}
          </>
        ) : (
          <p className="py-1 text-bf-xs text-muted-foreground">Not run in this session.</p>
        )}
      </InspectorSection>
    </div>
  );
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.map((v) => v.replace(/_/g, ' ')).join(', ') : 'none';
}

