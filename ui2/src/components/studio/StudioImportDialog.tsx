import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  StudioDiscoveryMemberGroup,
  StudioDiscoveryRolePattern,
  StudioImportCandidate,
  StudioImportMode,
} from '@/types/studio';
import { TsvImportWizard } from './TsvImportWizard';

const IMPORT_TABS: Array<{ mode: StudioImportMode; label: string; description: string }> = [
  { mode: 'table', label: 'From Table', description: 'TSV or CSV with file paths and design variables' },
  { mode: 'manifest', label: 'NeuroTabs Manifest', description: 'Pre-built manifest file' },
  { mode: 'regex', label: 'Discover Files', description: 'Find files by pattern' },
];

const COMMON_DISCOVERY_ROLES = new Set(['beta', 'tstat', 'se', 'pvalue', 'statmap']);

export function StudioImportDialog() {
  const isOpen = useSetStudioStore((state) => state.importDialog.isOpen);
  const mode = useSetStudioStore((state) => state.importDialog.mode);
  const tsvWizardStep = useSetStudioStore((state) => state.importDialog.tsvWizard.step);
  const selectedCandidateId = useSetStudioStore((state) => state.importDialog.selectedCandidateId);
  const isLoading = useSetStudioStore((state) => state.importDialog.isLoading);
  const error = useSetStudioStore((state) => state.importDialog.error);
  const source = useSetStudioStore((state) => state.importDialog.source);
  const manifestPath = useSetStudioStore((state) => state.importDialog.manifestPath);
  const discoveryRoot = useSetStudioStore((state) => state.importDialog.discoveryRoot);
  const filePattern = useSetStudioStore((state) => state.importDialog.filePattern);
  const discoveryMaxDepth = useSetStudioStore((state) => state.importDialog.discoveryMaxDepth);
  const discoveryMaxFiles = useSetStudioStore((state) => state.importDialog.discoveryMaxFiles);
  const discoverySampleHeaders = useSetStudioStore((state) => state.importDialog.discoverySampleHeaders);
  const discoveryRequiredRoles = useSetStudioStore((state) => state.importDialog.discoveryRequiredRoles);
  const discoveryRolePatterns = useSetStudioStore((state) => state.importDialog.discoveryRolePatterns);
  const discoveryCustomRole = useSetStudioStore((state) => state.importDialog.discoveryCustomRole);
  const importCandidates = useSetStudioStore((state) => state.importCandidates);
  const closeImportDialog = useSetStudioStore((state) => state.closeImportDialog);
  const openImportDialog = useSetStudioStore((state) => state.openImportDialog);
  const selectImportCandidate = useSetStudioStore((state) => state.selectImportCandidate);
  const confirmImportCandidate = useSetStudioStore((state) => state.confirmImportCandidate);
  const setTsvWizardStep = useSetStudioStore((state) => state.setTsvWizardStep);
  const setManifestPath = useSetStudioStore((state) => state.setManifestPath);
  const setDiscoveryRoot = useSetStudioStore((state) => state.setDiscoveryRoot);
  const setFilePattern = useSetStudioStore((state) => state.setFilePattern);
  const setDiscoveryMaxDepth = useSetStudioStore((state) => state.setDiscoveryMaxDepth);
  const setDiscoveryMaxFiles = useSetStudioStore((state) => state.setDiscoveryMaxFiles);
  const setDiscoverySampleHeaders = useSetStudioStore((state) => state.setDiscoverySampleHeaders);
  const setDiscoveryRolePattern = useSetStudioStore((state) => state.setDiscoveryRolePattern);
  const setDiscoveryRoleRequired = useSetStudioStore((state) => state.setDiscoveryRoleRequired);
  const setDiscoveryCustomRole = useSetStudioStore((state) => state.setDiscoveryCustomRole);
  const addDiscoveryRole = useSetStudioStore((state) => state.addDiscoveryRole);
  const removeDiscoveryRole = useSetStudioStore((state) => state.removeDiscoveryRole);

  const candidates = useMemo(
    () => Object.values(importCandidates).filter((candidate) => candidate.mode === mode),
    [importCandidates, mode]
  );
  const selectedCandidate =
    (selectedCandidateId ? importCandidates[selectedCandidateId] ?? null : null) ?? candidates[0] ?? null;
  const readiness = selectedCandidate ? deriveStudioReadiness(selectedCandidate) : null;
  const liveCaptureNames = useMemo(() => extractCaptureNames(filePattern), [filePattern]);
  const importLabel =
    readiness?.state === 'ready'
      ? 'Import For Compare'
      : readiness?.state === 'review'
        ? 'Import For Review'
        : 'Import Into Studio';

  // For table mode, show the wizard in steps 'load' and 'map',
  // and only show the candidate preview in step 'preview'
  const showTsvWizard = mode === 'table' && tsvWizardStep !== 'preview';
  // For table mode in preview step, or manifest/regex modes, show the classic layout
  const showClassicLayout = !showTsvWizard;

  const dialogTitle = mode === 'table'
    ? 'Import From Table'
    : mode === 'manifest'
      ? 'Import NeuroTabs Manifest'
      : 'Discover Files By Regex';

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeImportDialog}
      title={dialogTitle}
      size="full"
      bodyClassName="p-0"
      className="max-w-4xl rounded-lg"
    >
      <div style={{ maxHeight: 'calc(85vh - 4rem)' }} className="flex flex-col">
        {/* Tab bar */}
        <div className="flex border-b border-border bg-background px-4">
          {IMPORT_TABS.map((tab) => (
            <button
              key={tab.mode}
              type="button"
              onClick={() => openImportDialog(tab.mode)}
              className={`relative px-4 py-2.5 text-sm transition-colors ${
                mode === tab.mode
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {mode === tab.mode ? (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
              ) : null}
            </button>
          ))}
        </div>

        {/* TSV wizard (load + map steps) */}
        {showTsvWizard ? (
          <div className="flex-1 overflow-y-auto p-5">
            <TsvImportWizard />
          </div>
        ) : null}

        {/* Classic two-column layout for manifest, regex, and table preview step */}
        {showClassicLayout ? (
          <div className="flex-1 grid gap-0 md:grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
            <div className="border-r border-border bg-background p-4 overflow-y-auto">
              <div className="text-sm font-medium text-foreground">Preview candidates</div>
              <div className="mt-3 space-y-2">
                {candidates.map((candidate) => {
                  const isSelected = candidate.id === selectedCandidate?.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => selectImportCandidate(candidate.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-sky-500/50 bg-sky-500/10 text-foreground'
                          : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      <div className="text-sm font-medium">{candidate.label}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {candidate.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-background flex flex-col overflow-hidden">
             <div className="flex-1 overflow-y-auto p-5">
              {mode !== 'table' ? (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {isLoading
                        ? 'Loading preview...'
                        : source === 'backend'
                          ? 'Preview source: backend'
                          : source === 'fallback'
                            ? 'Preview source: fallback'
                            : 'Preview source: pending'}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void getSetIngestionService().openImportPreview(mode);
                      }}
                      disabled={isLoading}
                    >
                      Refresh
                    </Button>
                  </div>

                  {error ? (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
                      {error}
                    </div>
                  ) : null}

                  <div className="mb-4 rounded-lg border border-border bg-card p-4">
                    <div className="text-sm font-medium text-foreground">Preview request</div>
                    {mode === 'manifest' ? (
                      <div className="mt-3">
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Manifest Path
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          value={manifestPath}
                          onChange={(event) => setManifestPath(event.target.value)}
                          placeholder="/path/to/study.neurotabs.yaml"
                        />
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Discovery Root
                          </label>
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={discoveryRoot}
                            onChange={(event) => setDiscoveryRoot(event.target.value)}
                            placeholder="."
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            File Pattern
                          </label>
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={filePattern}
                            onChange={(event) => setFilePattern(event.target.value)}
                            placeholder=".*_statmap\\.nii(\\.gz)?$"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Max Depth
                          </label>
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={discoveryMaxDepth}
                            onChange={(event) => setDiscoveryMaxDepth(event.target.value)}
                            inputMode="numeric"
                            placeholder="4"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Max Files
                          </label>
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={discoveryMaxFiles}
                            onChange={(event) => setDiscoveryMaxFiles(event.target.value)}
                            inputMode="numeric"
                            placeholder="500"
                          />
                        </div>
                      </div>
                    )}
                    {mode === 'regex' ? (
                      <div className="mt-4 space-y-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Capture Preview</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {liveCaptureNames.length > 0 ? (
                              liveCaptureNames.map((name) => (
                                <span
                                  key={name}
                                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                >
                                  {name}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">No named captures</span>
                            )}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={discoverySampleHeaders}
                            onChange={(event) => setDiscoverySampleHeaders(event.target.checked)}
                          />
                          Sample headers
                        </label>
                        <DiscoveryRoleMappingControls
                          rolePatterns={discoveryRolePatterns}
                          requiredRoles={discoveryRequiredRoles}
                          customRole={discoveryCustomRole}
                          onPatternChange={setDiscoveryRolePattern}
                          onRequiredChange={setDiscoveryRoleRequired}
                          onCustomRoleChange={setDiscoveryCustomRole}
                          onAddCustomRole={addDiscoveryRole}
                          onRemoveRole={removeDiscoveryRole}
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              ) : tsvWizardStep === 'preview' ? (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {isLoading
                        ? 'Validating table preview...'
                        : source === 'backend'
                          ? 'Preview source: backend'
                          : source === 'fallback'
                            ? 'Preview source: fallback'
                            : 'Review the generated preview, or go back to adjust the mapping.'}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void getSetIngestionService().validateTablePreview();
                        }}
                        disabled={isLoading}
                      >
                        Refresh
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTsvWizardStep('map')}
                      >
                        Back to Mapping
                      </Button>
                    </div>
                  </div>

                  {error ? (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
                      {error}
                    </div>
                  ) : null}
                </>
              ) : null}

              {selectedCandidate ? (
                <ImportCandidatePreview candidate={selectedCandidate} readiness={readiness} />
              ) : (
                <div className="text-sm text-muted-foreground">No preview candidate available.</div>
              )}

             </div>
              <div className="shrink-0 border-t border-border px-5 py-3 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {readiness?.state === 'ready'
                    ? 'Studio will open this set ready for Compare.'
                    : readiness?.state === 'review'
                      ? 'Studio will open this set in Deck so you can review warnings first.'
                      : readiness?.state === 'blocked'
                        ? 'Studio will import this set for inspection, not trusted compare reading.'
                        : 'Studio will import the selected preview candidate.'}
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={closeImportDialog}>
                    Cancel
                  </Button>
                  <Button onClick={confirmImportCandidate} disabled={!selectedCandidate || isLoading}>
                    {importLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ImportCandidatePreview({
  candidate,
  readiness,
}: {
  candidate: StudioImportCandidate;
  readiness: ReturnType<typeof deriveStudioReadiness> | null;
}) {
  const { set } = candidate;
  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-foreground">{candidate.label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{candidate.sourceHint}</div>
        <div className="mt-2 text-sm text-muted-foreground">{candidate.description}</div>
      </div>

      {readiness ? (
        <div className={`rounded-lg border p-4 ${readiness.className}`}>
          <div className="text-xs font-medium">{readiness.eyebrow}</div>
          <div className="mt-2 text-sm font-medium">{readiness.title}</div>
          <div className="mt-1 text-sm">{readiness.message}</div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <PreviewCard
          title="Match Summary"
          accent={set.ingestAudit.join.severity}
          rows={[
            ['Matched', String(set.ingestAudit.join.matchedRows)],
            ['Unmatched', String(set.ingestAudit.join.unmatchedRows)],
            ['Duplicate Keys', String(set.ingestAudit.join.duplicateKeys)],
          ]}
        />
        <PreviewCard
          title="Template Check"
          accent={set.ingestAudit.support.severity}
          rows={[
            ['Template', set.ingestAudit.support.supportLabel],
            ['Alignment', set.ingestAudit.support.alignmentClass],
            ['Compare Ready', set.ingestAudit.support.readyForCompare ? 'Yes' : 'Not yet'],
          ]}
        />
      </div>

      {candidate.mode === 'regex' && candidate.discovery ? (
        <>
          <DiscoveryPreviewDetails candidate={candidate} />
          <DiscoveryNeuroTabsExportPanel candidate={candidate} />
        </>
      ) : null}

      {set.ingestAudit.join.issueDetails.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="text-sm font-medium text-foreground">Import issues</div>
          <div className="mt-3 space-y-2">
            {set.ingestAudit.join.issueDetails.map((detail) => (
              <div
                key={`${detail.message}-${detail.memberIds.join('|')}`}
                className="text-sm text-foreground"
              >
                {detail.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">Metadata Fields</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {set.designColumns.map((column) => (
            <span
              key={column}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
            >
              {column}
            </span>
          ))}
        </div>
      </div>

      {set.designTablePreview?.rows.length ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-foreground">Preview rows</div>
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <div
              className="grid gap-2 border-b border-border bg-background px-3 py-2 text-[11px] text-muted-foreground"
              style={{
                gridTemplateColumns: `repeat(${Math.max(
                  Math.min(set.designTablePreview.columns.length, 4),
                  1
                )}, minmax(0, 1fr))`,
              }}
            >
              {set.designTablePreview.columns.slice(0, 4).map((column) => (
                <span key={column}>{column}</span>
              ))}
            </div>
            {set.designTablePreview.rows.slice(0, 4).map((row) => (
              <div
                key={row.id}
                className="grid gap-2 border-t border-border px-3 py-2 text-sm text-foreground first:border-t-0"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(
                    Math.min(set.designTablePreview?.columns.length ?? 0, 4),
                    1
                  )}, minmax(0, 1fr))`,
                }}
              >
                {row.cells.slice(0, 4).map((cell, index) => (
                  <span key={`${row.id}-${index}`}>{cell}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {set.ingestAudit.notes.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-foreground">Import notes</div>
          <div className="mt-3 space-y-2">
            {set.ingestAudit.notes.map((note) => (
              <div key={note} className="text-sm text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiscoveryNeuroTabsExportPanel({ candidate }: { candidate: StudioImportCandidate }) {
  const [status, setStatus] = useState<{
    state: 'idle' | 'saving' | 'saved' | 'error';
    message: string | null;
  }>({ state: 'idle', message: null });
  const limitation = discoveryExportLimitation(candidate);
  const disabled = Boolean(limitation) || status.state === 'saving';

  const handleExport = async () => {
    setStatus({ state: 'saving', message: null });
    try {
      const result = await getSetIngestionService().exportDiscoveryNeuroTabs(candidate);
      setStatus({
        state: 'saved',
        message: result.manifestPath ?? result.message,
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'NeuroTabs export failed.',
      });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">NeuroTabs Export</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {limitation ?? 'Save a manifest package beside the discovered files.'}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void handleExport();
          }}
          disabled={disabled}
        >
          {status.state === 'saving' ? 'Saving...' : 'Save NeuroTabs Manifest'}
        </Button>
      </div>
      {status.message ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            status.state === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-foreground'
              : 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
          }`}
        >
          {status.message}
        </div>
      ) : null}
    </div>
  );
}

function DiscoveryRoleMappingControls({
  rolePatterns,
  requiredRoles,
  customRole,
  onPatternChange,
  onRequiredChange,
  onCustomRoleChange,
  onAddCustomRole,
  onRemoveRole,
}: {
  rolePatterns: StudioDiscoveryRolePattern[];
  requiredRoles: string[];
  customRole: string;
  onPatternChange: (role: string, patterns: string[]) => void;
  onRequiredChange: (role: string, required: boolean) => void;
  onCustomRoleChange: (role: string) => void;
  onAddCustomRole: (role: string) => void;
  onRemoveRole: (role: string) => void;
}) {
  const requiredSet = useMemo(() => new Set(requiredRoles), [requiredRoles]);
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">Role Mapping</div>
      <div className="mt-2 overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[84px_minmax(0,1fr)_72px] gap-2 border-b border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
          <span>Role</span>
          <span>Patterns</span>
          <span>Required</span>
        </div>
        {rolePatterns.map((entry) => {
          const isCommon = COMMON_DISCOVERY_ROLES.has(entry.role);
          return (
            <div
              key={entry.role}
              className="grid grid-cols-[84px_minmax(0,1fr)_72px] items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
            >
              <div className="text-sm font-medium text-foreground">{entry.role}</div>
              <div className="flex min-w-0 gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={entry.patterns.join(', ')}
                  onChange={(event) => onPatternChange(entry.role, splitPatternText(event.target.value))}
                />
                {!isCommon ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveRole(entry.role)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  checked={requiredSet.has(entry.role)}
                  onChange={(event) => onRequiredChange(entry.role, event.target.checked)}
                  aria-label={`${entry.role} required`}
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={customRole}
          onChange={(event) => onCustomRoleChange(event.target.value)}
          placeholder="custom_role"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onAddCustomRole(customRole)}
          disabled={!customRole.trim()}
        >
          Add Role
        </Button>
      </div>
    </div>
  );
}

function DiscoveryPreviewDetails({ candidate }: { candidate: StudioImportCandidate }) {
  const discovery = candidate.discovery;
  if (!discovery) {
    return null;
  }
  const roles = discoveryMatrixRoles(discovery.requiredRoles, discovery.observedRoles, discovery.groups);
  const shownGroups = discovery.groups.slice(0, 8);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Discovery Matrix</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {discovery.matchedFiles} matched / {discovery.unmatchedFiles} unmatched / {discovery.duplicateKeys} duplicates
          </div>
        </div>
        {discovery.truncated ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-foreground">
            Truncated
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {discovery.captureNames.map((name) => (
          <span
            key={name}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
          >
            {name}
          </span>
        ))}
      </div>

      {roles.length > 0 && shownGroups.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="bg-background text-[11px] text-muted-foreground">
              <tr>
                <th className="border-b border-border px-3 py-2 font-medium">Member</th>
                {roles.map((role) => (
                  <th key={role} className="border-b border-border px-3 py-2 font-medium">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownGroups.map((group) => (
                <tr key={group.memberId} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-2 font-medium text-foreground">{group.memberId}</td>
                  {roles.map((role) => (
                    <td key={`${group.memberId}-${role}`} className="px-3 py-2">
                      <DiscoveryRoleCell group={group} role={role} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {discovery.groups.length > shownGroups.length ? (
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {shownGroups.length} of {discovery.groups.length} member groups
        </div>
      ) : null}
    </div>
  );
}

function DiscoveryRoleCell({
  group,
  role,
}: {
  group: StudioDiscoveryMemberGroup;
  role: string;
}) {
  const matching = group.bindings.filter((binding) => binding.role === role);
  const duplicate = group.duplicateRoles.includes(role);
  const missing = group.missingRoles.includes(role) || matching.length === 0;
  const label = duplicate ? 'Dup' : missing ? 'Missing' : 'OK';
  const className = duplicate
    ? 'border-amber-500/30 bg-amber-500/10 text-foreground'
    : missing
      ? 'border-rose-500/30 bg-rose-500/10 text-foreground'
      : 'border-emerald-500/30 bg-emerald-500/10 text-foreground';
  const title = matching.map((binding) => binding.relativePath).join('\n');

  return (
    <span
      className={`inline-flex min-w-[64px] justify-center rounded-full border px-2 py-1 text-xs ${className}`}
      title={title || undefined}
    >
      {label}
    </span>
  );
}

function discoveryMatrixRoles(
  requiredRoles: string[],
  observedRoles: string[],
  groups: StudioDiscoveryMemberGroup[]
): string[] {
  const roleSet = new Set<string>();
  requiredRoles.forEach((role) => roleSet.add(role));
  observedRoles.forEach((role) => roleSet.add(role));
  groups.forEach((group) => {
    group.bindings.forEach((binding) => roleSet.add(binding.role));
  });
  return Array.from(roleSet).sort();
}

function discoveryExportLimitation(candidate: StudioImportCandidate): string | null {
  const discovery = candidate.discovery;
  if (!discovery) {
    return 'No discovery summary is available for NeuroTabs export.';
  }
  if (!discovery.root.trim() || discovery.root.includes('://')) {
    return 'Remote discovery roots must be materialized locally before NeuroTabs export.';
  }
  if (discovery.truncated) {
    return 'Increase the max-files limit and refresh before exporting.';
  }
  if (discovery.unmatchedFiles > 0) {
    return 'Resolve unmatched neuroimaging files before exporting.';
  }
  if (discovery.duplicateKeys > 0) {
    return 'Resolve duplicate role bindings before exporting.';
  }
  const dirtyGroup = discovery.groups.find(
    (group) => group.missingRoles.length > 0 || group.duplicateRoles.length > 0
  );
  if (dirtyGroup) {
    return `Resolve missing or duplicate roles for ${dirtyGroup.memberId} before exporting.`;
  }
  return null;
}

function splitPatternText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function extractCaptureNames(pattern: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const capturePattern = /\(\?(?:P<|<)([A-Za-z_][A-Za-z0-9_]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = capturePattern.exec(pattern)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function deriveStudioReadiness(candidate: StudioImportCandidate) {
  const { set } = candidate;
  const hasJoinProblems =
    set.ingestAudit.join.unmatchedRows > 0 || set.ingestAudit.join.duplicateKeys > 0;
  const compareReady = set.ingestAudit.support.readyForCompare;

  if (compareReady && !hasJoinProblems) {
    return {
      state: 'ready' as const,
      eyebrow: 'Studio Ready',
      title: 'Ready for compare-centered reading',
      message:
        'This import can go directly into Deck and Compare without additional alignment or join cleanup.',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-foreground',
    };
  }

  if (set.ingestAudit.join.severity === 'error' || set.ingestAudit.support.severity === 'error') {
    return {
      state: 'blocked' as const,
      eyebrow: 'Audit Attention',
      title: 'Import for inspection first',
      message:
        'The preview surfaced blocking audit errors. Use Studio to inspect and repair the set before relying on compare views.',
      className: 'border-rose-500/30 bg-rose-500/10 text-foreground',
    };
  }

  return {
    state: 'review' as const,
    eyebrow: 'Deck First',
    title: 'Import for review before compare',
    message:
      'The set is still useful in Deck, but join or support warnings mean compare outputs should be treated as provisional until the audit is clean.',
    className: 'border-amber-500/30 bg-amber-500/10 text-foreground',
  };
}

function PreviewCard({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: Array<[string, string]>;
  accent: 'ok' | 'warning' | 'error';
}) {
  const accentClass =
    accent === 'ok'
      ? 'border-emerald-500/30'
      : accent === 'warning'
        ? 'border-amber-500/30'
        : 'border-rose-500/30';

  return (
    <div className={`rounded-lg border bg-card p-4 ${accentClass}`}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
