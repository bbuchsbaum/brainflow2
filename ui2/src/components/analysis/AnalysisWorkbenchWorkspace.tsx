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
import { Button } from '@/components/ui/shadcn/button';
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

  return (
    <div className="rounded-appsm border border-border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="bf-role-section text-muted-foreground">Job</p>
          <p className="bf-role-body text-foreground truncate">
            {descriptor?.name ?? job.analysis_id}
          </p>
          <p className="bf-role-mono text-bf-2xs text-muted-foreground mt-1 truncate">
            {job.job_id}
          </p>
        </div>
        <JobStatusPill state={job.state} />
      </div>

      {progressPct !== null && (job.state === 'queued' || job.state === 'running' || job.state === 'completed') && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-sm bg-bf-bg-panel-sunken overflow-hidden">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-bf-2xs text-muted-foreground">
            <span>{job.message ?? 'No status message'}</span>
            <span>{progressPct}%</span>
          </div>
        </div>
      )}

      {job.error && (
        <div className="rounded-appsm border border-destructive/40 bg-destructive/10 px-3 py-2 text-bf-xs text-destructive">
          {job.error}
        </div>
      )}

      {job.artifacts && job.artifacts.length > 0 && (
        <div className="space-y-2">
          <p className="bf-role-section text-muted-foreground">Artifacts</p>
          {job.artifacts.map((artifact, index) => (
            <div
              key={`${job.job_id}-${artifact.path}-${index}`}
              className="rounded-appsm border border-bf-border-subtle bg-bf-bg-panel-sunken px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-bf-md text-foreground truncate">
                    {artifact.name ?? artifact.kind}
                  </p>
                  <p className="text-bf-2xs text-muted-foreground mt-1">
                    {artifact.kind}
                  </p>
                  <p className="bf-role-mono text-bf-2xs text-muted-foreground truncate mt-1" title={artifact.path}>
                    {artifact.path}
                  </p>
                </div>
                {isArtifactOpenable(artifact) && (
                  <button
                    type="button"
                    className="shrink-0 rounded-appsm border border-border px-2.5 py-1 text-bf-2xs text-foreground hover:bg-accent"
                    onClick={() => onOpenArtifact(artifact)}
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(job.state === 'queued' || job.state === 'running') && (
        <button
          type="button"
          className="rounded-appsm border border-border px-3 py-1.5 text-bf-2xs text-foreground hover:bg-accent"
          onClick={() => onCancel(job.job_id)}
        >
          Cancel job
        </button>
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

  return (
    <div className="absolute inset-0 flex overflow-hidden bg-background text-foreground">
      <aside className="w-72 shrink-0 border-r border-border bg-card/40 p-4 overflow-y-auto">
        <div className="space-y-2">
          <p className="bf-role-section text-muted-foreground">Analyses</p>
          <h2 className="bf-role-title text-foreground">Analysis workbench</h2>
          <p className="bf-role-body text-muted-foreground">
            Builtin and sidecar analysis descriptors discovered from the backend.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          {loadStatus === 'loading' && (
            <div className="rounded-appsm border border-border bg-card px-3 py-2 text-bf-md text-muted-foreground">
              Loading analyses…
            </div>
          )}
          {loadError && (
            <div className="rounded-appsm border border-destructive/40 bg-destructive/10 px-3 py-2 text-bf-md text-destructive">
              {loadError}
            </div>
          )}
          {descriptors.map((descriptor) => {
            const isSelected = descriptor.id === selectedAnalysisId;
            return (
              <button
                key={descriptor.id}
                type="button"
                onClick={() => selectAnalysis(descriptor.id)}
                className={`w-full rounded-appsm border px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-border bg-bf-bg-selected shadow-[inset_2px_0_0_var(--bf-accent)]'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-bf-md font-medium text-foreground">{descriptor.name}</span>
                  <span className="text-bf-xs text-bf-text-secondary">
                    {runnerLabel(descriptor)}
                  </span>
                </div>
                <p className="text-bf-sm text-muted-foreground mt-1 truncate">
                  {descriptor.description ?? 'No description'}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto p-5">
        {!selectedDescriptor ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select an analysis to inspect its contract.
          </div>
        ) : (
          <div className="space-y-5">
            <header className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-appsm border border-border px-2 py-1 text-bf-xs text-bf-text-secondary">
                  {runnerLabel(selectedDescriptor)}
                </span>
                <span className="rounded-appsm border border-border px-2 py-1 text-bf-xs text-bf-text-secondary">
                  v{selectedDescriptor.version}
                </span>
              </div>
              <h1 className="bf-role-title text-foreground">{selectedDescriptor.name}</h1>
              <p className="bf-role-body text-muted-foreground">
                {selectedDescriptor.description ?? 'No description provided.'}
              </p>
            </header>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                <div className="rounded-appsm border border-border bg-card p-4 space-y-4">
                  <div>
                    <p className="bf-role-section text-muted-foreground">Contract</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-bf-xs font-medium text-muted-foreground">Inputs</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedDescriptor.inputs.length > 0 ? (
                            selectedDescriptor.inputs.map((inputKind) => (
                              <span
                                key={inputKind}
                                className="rounded-appsm border border-border px-2 py-1 text-bf-xs text-foreground"
                              >
                                {inputKind}
                              </span>
                            ))
                          ) : (
                            <span className="text-bf-md text-muted-foreground">No inputs</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-bf-xs font-medium text-muted-foreground">Outputs</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedDescriptor.outputs.map((outputKind) => (
                            <span
                              key={outputKind}
                              className="rounded-appsm border border-border px-2 py-1 text-bf-xs text-foreground"
                            >
                              {outputKind}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 border-t border-border pt-3">
                    <p className="text-bf-xs font-medium text-muted-foreground">Bound input</p>
                    {bindingState.inputs[0] ? (
                      <div className="mt-2 min-w-0 space-y-1">
                        <p
                          className="truncate text-bf-md text-foreground"
                          title={bindingState.inputs[0].name ?? bindingState.inputs[0].handle ?? undefined}
                        >
                          {bindingState.inputs[0].name ?? bindingState.inputs[0].handle}
                        </p>
                        <p
                          className="bf-role-mono text-bf-2xs text-muted-foreground truncate"
                          title={bindingState.inputs[0].path ?? undefined}
                        >
                          {bindingState.inputs[0].path}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-bf-md text-muted-foreground">{bindingState.reason}</p>
                    )}
                  </div>

                  <p className="text-bf-md text-muted-foreground">
                    The current workbench slice supports runnable single-volume analyses.
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-bf-xs font-medium text-muted-foreground">Parameters (JSON)</p>
                      <button
                        type="button"
                        className="rounded-appsm border border-border px-2.5 py-1 text-bf-2xs text-foreground hover:bg-accent"
                        onClick={() => setParamDraft(selectedDescriptor.id, '{}')}
                      >
                        Clear
                      </button>
                    </div>
                    <textarea
                      value={paramDraft}
                      onChange={(event) => setParamDraft(selectedDescriptor.id, event.target.value)}
                      spellCheck={false}
                      className="min-h-[220px] w-full rounded-appsm border border-border bg-background px-3 py-2 font-mono text-bf-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  {startError && (
                    <div className="rounded-appsm border border-destructive/40 bg-destructive/10 px-3 py-2 text-bf-md text-destructive">
                      {startError}
                    </div>
                  )}

                  <div className="flex items-center">
                    <Button
                      type="button"
                      variant="default"
                      size="lg"
                      className="shrink-0"
                      disabled={isStarting || bindingState.inputs.length === 0}
                      onClick={handleRun}
                    >
                      {isStarting ? 'Starting…' : 'Run Analysis'}
                    </Button>
                  </div>
                </div>
              </div>

              <aside className="space-y-4">
                <div>
                  <p className="bf-role-section text-muted-foreground">Jobs</p>
                  <h2 className="bf-role-title text-foreground mt-1">Run history</h2>
                </div>

                {artifactError && (
                  <div className="rounded-appsm border border-destructive/40 bg-destructive/10 px-3 py-2 text-bf-md text-destructive">
                    {artifactError}
                  </div>
                )}

                {jobs.length === 0 ? (
                  <div className="rounded-appsm border border-border bg-card p-4 text-bf-md text-muted-foreground">
                    No analysis jobs yet. Run the selected analysis to populate this panel.
                  </div>
                ) : (
                  <div className="space-y-3">
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
