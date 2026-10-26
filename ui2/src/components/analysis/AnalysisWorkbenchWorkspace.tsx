import React, { useEffect, useMemo, useState } from 'react';
import type {
  AnalysisArtifact,
  AnalysisDescriptor,
  AnalysisInput,
  AnalysisJobStatus,
} from '@brainflow/api';
import { useSelectedLayer, useSelectedLayerId, useLayerMetadata } from '@/stores/layerStore';
import { getAnalysisService } from '@/services/analysis/AnalysisService';
import { buildAnalysisStartRequest, useAnalysisStore } from '@/stores/analysisStore';
import {
  Button,
  Chip,
  FieldRow,
  KeyValue,
  Notice,
  Section,
  SelectableRow,
  TextArea,
  useRovingFocus,
  type KeyValueItem,
} from '@/components/ui/bf';
import { JobStatusPill } from './JobStatusPill';

interface AnalysisWorkbenchWorkspaceProps {
  workspaceId: string;
}

function runnerLabel(descriptor: AnalysisDescriptor): string {
  return descriptor.runner.type === 'builtin' ? 'Builtin' : 'Sidecar';
}

function isArtifactOpenable(artifact: AnalysisArtifact): boolean {
  return artifact.kind === 'volume' || artifact.kind === 'surface' || artifact.kind === 'file';
}

function getBindingState(
  descriptor: AnalysisDescriptor | undefined,
  selectedLayer: ReturnType<typeof useSelectedLayer>,
  selectedLayerPath: string | undefined
): { inputs: AnalysisInput[]; reason: string | null } {
  if (!descriptor) {
    return { inputs: [], reason: 'Select an analysis to configure inputs.' };
  }

  if (descriptor.inputs.length === 0) {
    return { inputs: [], reason: null };
  }

  if (descriptor.inputs.length !== 1 || descriptor.inputs[0] !== 'volume') {
    return {
      inputs: [],
      reason: 'This first workbench slice only supports single-volume analyses. Multi-input or non-volume bindings are listed but not runnable yet.',
    };
  }

  if (!selectedLayer) {
    return {
      inputs: [],
      reason: 'Select a volume layer in the app to bind it as the analysis input.',
    };
  }

  if (!selectedLayerPath) {
    return {
      inputs: [],
      reason: 'The selected volume does not have a resolved source path, so it cannot be passed to the analysis runner.',
    };
  }

  return {
    inputs: [
      {
        kind: 'volume',
        handle: selectedLayer.id,
        path: selectedLayerPath,
        name: selectedLayer.name,
        metadata: {
          layerType: selectedLayer.type,
          source: selectedLayer.source ?? null,
          sourcePath: selectedLayerPath,
        },
      },
    ],
    reason: null,
  };
}

function JobCard({
  descriptor,
  job,
  onCancel,
  onOpenArtifact,
}: {
  descriptor: AnalysisDescriptor | undefined;
  job: AnalysisJobStatus;
  onCancel: (jobId: string) => void;
  onOpenArtifact: (artifact: AnalysisArtifact) => void;
}) {
  const progressPct =
    typeof job.progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(job.progress * 100)))
      : null;
  const showProgress =
    progressPct !== null &&
    (job.state === 'queued' || job.state === 'running' || job.state === 'completed');

  const facts: KeyValueItem[] = [{ key: 'job', label: 'Job id', value: job.job_id, wide: true }];
  if (showProgress) {
    facts.push({ key: 'progress', label: 'Progress', value: `${progressPct}%` });
    facts.push({
      key: 'message',
      label: 'Message',
      value: job.message ?? 'No status message',
      mono: false,
    });
  }

  return (
    <div className="space-y-2 rounded-sm border border-bf-border-subtle bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-bf-sm font-semibold text-foreground">
          {descriptor?.name ?? job.analysis_id}
        </p>
        <JobStatusPill state={job.state} />
      </div>

      {showProgress && (
        <div
          role="progressbar"
          aria-label="Job progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct ?? undefined}
          className="h-1 overflow-hidden rounded-sm bg-bf-bg-panel-sunken"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <KeyValue items={facts} />

      {job.error && (
        <Notice severity="danger" role={undefined}>
          {job.error}
        </Notice>
      )}

      {job.artifacts && job.artifacts.length > 0 && (
        <div className="space-y-1">
          <p className="text-bf-xs text-muted-foreground">Artifacts</p>
          {job.artifacts.map((artifact, index) => (
            <div
              key={`${job.job_id}-${artifact.path}-${index}`}
              className="flex items-start justify-between gap-3 rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken px-2 py-1.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-bf-sm text-foreground">
                    {artifact.name ?? artifact.kind}
                  </span>
                  <Chip>{artifact.kind}</Chip>
                </div>
                <p className="truncate font-mono text-bf-2xs text-muted-foreground" title={artifact.path}>
                  {artifact.path}
                </p>
              </div>
              {isArtifactOpenable(artifact) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onOpenArtifact(artifact)}
                >
                  Open
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {(job.state === 'queued' || job.state === 'running') && (
        <Button variant="secondary" size="sm" onClick={() => onCancel(job.job_id)}>
          Cancel job
        </Button>
      )}
    </div>
  );
}

export function AnalysisWorkbenchWorkspace({ workspaceId: _workspaceId }: AnalysisWorkbenchWorkspaceProps) {
  const descriptors = useAnalysisStore((state) => state.descriptors);
  const selectedAnalysisId = useAnalysisStore((state) => state.selectedAnalysisId);
  const loadStatus = useAnalysisStore((state) => state.loadStatus);
  const loadError = useAnalysisStore((state) => state.loadError);
  const jobs = useAnalysisStore((state) => state.jobs);
  const paramDrafts = useAnalysisStore((state) => state.paramDrafts);
  const isStarting = useAnalysisStore((state) => state.isStarting);
  const startError = useAnalysisStore((state) => state.startError);
  const loadAnalyses = useAnalysisStore((state) => state.loadAnalyses);
  const selectAnalysis = useAnalysisStore((state) => state.selectAnalysis);
  const setParamDraft = useAnalysisStore((state) => state.setParamDraft);
  const startAnalysis = useAnalysisStore((state) => state.startAnalysis);
  const pollActiveJobs = useAnalysisStore((state) => state.pollActiveJobs);
  const cancelJob = useAnalysisStore((state) => state.cancelJob);
  const setStartError = useAnalysisStore((state) => state.setStartError);
  const selectedLayerId = useSelectedLayerId();
  const selectedLayer = useSelectedLayer();
  const selectedLayerMetadata = useLayerMetadata(selectedLayerId ?? '__no-selected-layer__');
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    if (loadStatus === 'idle') {
      void loadAnalyses();
    }
  }, [loadAnalyses, loadStatus]);

  const activeJobCount = useMemo(
    () => jobs.filter((job) => job.state === 'queued' || job.state === 'running').length,
    [jobs]
  );

  useEffect(() => {
    if (activeJobCount === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void pollActiveJobs();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeJobCount, pollActiveJobs]);

  const selectedDescriptor = useMemo(
    () => descriptors.find((descriptor) => descriptor.id === selectedAnalysisId),
    [descriptors, selectedAnalysisId]
  );

  const bindingState = useMemo(
    () =>
      getBindingState(
        selectedDescriptor,
        selectedLayer,
        selectedLayerMetadata?.sourcePath
      ),
    [selectedDescriptor, selectedLayer, selectedLayerMetadata?.sourcePath]
  );

  const paramDraft = selectedDescriptor ? paramDrafts[selectedDescriptor.id] ?? '{}' : '{}';
  // Inline JSON validation (empty = no parameters, as buildAnalysisStartRequest).
  const paramsError = useMemo(() => parametersJsonError(paramDraft), [paramDraft]);

  const analysisIds = useMemo(() => descriptors.map((descriptor) => descriptor.id), [descriptors]);
  const roving = useRovingFocus({ ids: analysisIds, activeId: selectedAnalysisId ?? null });

  const handleRun = async () => {
    if (!selectedDescriptor) {
      return;
    }

    try {
      setStartError(null);
      const request = buildAnalysisStartRequest(
        selectedDescriptor.id,
        bindingState.inputs,
        paramDraft
      );
      await startAnalysis(request);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Failed to parse analysis parameters');
    }
  };

  const handleOpenArtifact = async (artifact: AnalysisArtifact) => {
    try {
      setArtifactError(null);
      await getAnalysisService().openArtifact(artifact);
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : 'Failed to open analysis artifact');
    }
  };

  const boundInput = bindingState.inputs[0];
  const contractItems: KeyValueItem[] = selectedDescriptor
    ? [
        {
          key: 'inputs',
          label: 'Inputs',
          value:
            selectedDescriptor.inputs.length > 0 ? (
              <>
                {selectedDescriptor.inputs.map((input) => (
                  <Chip key={input} mono>
                    {input}
                  </Chip>
                ))}
              </>
            ) : (
              'None'
            ),
          mono: selectedDescriptor.inputs.length > 0,
        },
        {
          key: 'outputs',
          label: 'Outputs',
          value:
            selectedDescriptor.outputs.length > 0 ? (
              <>
                {selectedDescriptor.outputs.map((output) => (
                  <Chip key={output} mono>
                    {output}
                  </Chip>
                ))}
              </>
            ) : (
              'None'
            ),
          mono: selectedDescriptor.outputs.length > 0,
        },
      ]
    : [];
  const boundItems: KeyValueItem[] = boundInput
    ? [
        {
          key: 'name',
          label: 'Volume',
          value: boundInput.name ?? boundInput.handle,
          wide: true,
        },
        { key: 'path', label: 'Path', value: boundInput.path ?? '', wide: true },
      ]
    : [];

  return (
    <div className="absolute inset-0 flex overflow-hidden bg-background text-foreground">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card/40 p-3">
        <div className="space-y-1">
          <h2 className="bf-role-title text-foreground">Analysis workbench</h2>
          <p className="text-bf-sm text-muted-foreground">
            Builtin and sidecar analysis descriptors discovered from the backend.
          </p>
        </div>

        <div className="mt-3 space-y-2">
          {loadStatus === 'loading' && <Notice severity="neutral">Loading analyses…</Notice>}
          {loadError && (
            <Notice severity="danger" role="alert">
              {loadError}
            </Notice>
          )}
          {descriptors.length > 0 && (
            <div
              role="listbox"
              aria-label="Analyses"
              className="space-y-1.5"
              onKeyDown={roving.onKeyDown}
            >
              {descriptors.map((descriptor) => {
                const isSelected = descriptor.id === selectedAnalysisId;
                return (
                  <SelectableRow
                    key={descriptor.id}
                    variant="card"
                    selected={isSelected}
                    onSelect={() => selectAnalysis(descriptor.id)}
                    {...roving.getItemProps(descriptor.id)}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-bf-sm font-medium text-foreground">
                        {descriptor.name}
                      </span>
                      <Chip>{runnerLabel(descriptor)}</Chip>
                    </div>
                    <p className="truncate text-bf-xs text-muted-foreground">
                      {descriptor.description ?? 'No description'}
                    </p>
                  </SelectableRow>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {!selectedDescriptor ? (
          <div className="flex h-full items-center justify-center">
            <Notice severity="neutral" role={undefined}>
              Select an analysis to inspect its contract.
            </Notice>
          </div>
        ) : (
          <div className="space-y-4">
            <header className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Chip>{runnerLabel(selectedDescriptor)}</Chip>
                <Chip mono>v{selectedDescriptor.version}</Chip>
              </div>
              <h1 className="bf-role-title text-foreground">{selectedDescriptor.name}</h1>
              <p className="text-bf-sm text-muted-foreground">
                {selectedDescriptor.description ?? 'No description provided.'}
              </p>
            </header>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 rounded-sm border border-bf-border-subtle bg-card">
                <Section variant="static" divider={false} title="Contract">
                  <KeyValue columns={1} wrap items={contractItems} />
                </Section>

                <Section variant="static" title="Bound input">
                  {boundInput ? (
                    <KeyValue items={boundItems} columns={1} />
                  ) : (
                    <Notice severity="neutral" role={undefined}>
                      {bindingState.reason}
                    </Notice>
                  )}
                  <p className="mt-2 text-bf-xs text-muted-foreground">
                    The current workbench slice supports runnable single-volume analyses.
                  </p>
                </Section>

                <Section variant="static" title="Parameters">
                  <FieldRow
                    layout="stacked"
                    label="JSON"
                    // Validated on every edit: the message sits under the
                    // field (aria-invalid + aria-describedby via FieldRow) and
                    // Run Analysis stays disabled until the JSON parses.
                    error={paramsError ?? undefined}
                    meta={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="font-sans"
                        onClick={() => setParamDraft(selectedDescriptor.id, '{}')}
                      >
                        Clear
                      </Button>
                    }
                  >
                    <TextArea
                      mono
                      value={paramDraft}
                      onChange={(event) => setParamDraft(selectedDescriptor.id, event.target.value)}
                      spellCheck={false}
                      className="min-h-[220px]"
                    />
                  </FieldRow>

                  {startError && (
                    <Notice severity="danger" role="alert" className="mt-2">
                      {startError}
                    </Notice>
                  )}

                  {/* The workbench's one primary action: its own row, the md
                      (28px) step above the 24px panel controls. */}
                  <div className="mt-3 flex items-center border-t border-bf-border-subtle pt-3">
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      className="shrink-0"
                      disabled={isStarting || bindingState.inputs.length === 0 || paramsError !== null}
                      onClick={handleRun}
                    >
                      {isStarting ? 'Starting…' : 'Run Analysis'}
                    </Button>
                  </div>
                </Section>
              </div>

              <aside className="min-w-0 space-y-3">
                <h2 className="bf-role-title text-foreground">Run history</h2>

                {artifactError && (
                  <Notice severity="danger" role="alert">
                    {artifactError}
                  </Notice>
                )}

                {jobs.length === 0 ? (
                  <Notice severity="neutral" role={undefined}>
                    No analysis jobs yet. Run the selected analysis to populate this panel.
                  </Notice>
                ) : (
                  <div className="space-y-2">
                    {jobs.map((job) => (
                      <JobCard
                        key={job.job_id}
                        descriptor={descriptors.find((descriptor) => descriptor.id === job.analysis_id)}
                        job={job}
                        onCancel={(jobId) => void cancelJob(jobId)}
                        onOpenArtifact={(artifact) => void handleOpenArtifact(artifact)}
                      />
                    ))}
                  </div>
                )}
              </aside>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

/** Sentence-case message for parameters text that is not valid JSON, or null. */
export function parametersJsonError(text: string): string | null {
  if (text.trim().length === 0) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Not valid JSON: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
  }
}
