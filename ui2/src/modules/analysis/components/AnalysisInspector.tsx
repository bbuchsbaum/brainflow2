import React, { useMemo } from 'react';
import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';
import { JobStatusPill, KeyValue, Notice, Section, type KeyValueItem } from '@/components/ui/bf';

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

      <Section title="Contract" defaultOpen>
        <KeyValue
          layout="rows"
          items={[
            { label: 'Inputs', value: formatList(descriptor.inputs), mono: false },
            { label: 'Outputs', value: formatList(descriptor.outputs), mono: false },
            { label: 'Runner', value: descriptor.runner.type },
          ]}
        />
      </Section>

      <Section title="Last job" defaultOpen>
        {latestJob ? (
          <>
            <KeyValue layout="rows" items={lastJobFacts(latestJob)} />
            {latestJob.error ? (
              <Notice severity="danger" role={undefined} className="mt-2 [overflow-wrap:anywhere]">
                {latestJob.error}
              </Notice>
            ) : null}
          </>
        ) : (
          <Notice role={undefined}>Not run in this session.</Notice>
        )}
      </Section>
    </div>
  );
}

type AnalysisJob = ReturnType<typeof useAnalysisStore.getState>['jobs'][number];

function lastJobFacts(job: AnalysisJob): KeyValueItem[] {
  const facts: KeyValueItem[] = [
    { label: 'Job', value: job.job_id },
    { label: 'State', value: <JobStatusPill state={job.state} />, mono: false },
  ];
  if (job.progress !== null) {
    facts.push({ label: 'Progress', value: `${Math.round(job.progress * 100)}%` });
  }
  facts.push({ label: 'Artifacts', value: String(job.artifacts?.length ?? 0) });
  return facts;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.map((v) => v.replace(/_/g, ' ')).join(', ') : 'none';
}

