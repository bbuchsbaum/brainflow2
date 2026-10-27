import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Chip, FieldRow, Notice, SelectableRow, Tabs, TextField, tabIds, useRovingFocus } from '@/components/ui/bf';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { canImportCandidate } from '@/services/studio/importContract';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  StudioDiscoveryMemberGroup,
  StudioDiscoveryRolePattern,
  StudioFolderOntologyCandidate,
  StudioFolderOntologySummary,
  StudioImportCandidate,
  StudioImportMode,
} from '@/types/studio';
import { TsvImportWizard } from './TsvImportWizard';
import { seriesAxisLabel } from './seriesAxisLabel';

const IMPORT_TABS_ID = 'studio-import';

const IMPORT_TABS: Array<{ mode: StudioImportMode; label: string; description: string }> = [
  { mode: 'table', label: 'From table', description: 'TSV or CSV with file paths and design variables' },
  { mode: 'manifest', label: 'NeuroTabs Manifest', description: 'Pre-built manifest file' },
  { mode: 'regex', label: 'Discover files', description: 'Find files by pattern' },
];

const COMMON_DISCOVERY_ROLES = new Set(['beta', 'tstat', 'se', 'pvalue', 'statmap']);

export function StudioImportDialog() {
  const isOpen = useSetStudioStore((state) => state.importDialog.isOpen && !state.importDialog.folderReview);
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
  const ontologyPreview = useSetStudioStore((state) => state.importDialog.ontologyPreview);
  const isOntologyLoading = useSetStudioStore((state) => state.importDialog.isOntologyLoading);
  const ontologyError = useSetStudioStore((state) => state.importDialog.ontologyError);
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
  const applyFolderOntologyCandidate = useSetStudioStore((state) => state.applyFolderOntologyCandidate);

  const candidates = useMemo(
    () => Object.values(importCandidates).filter((candidate) => candidate.mode === mode),
    [importCandidates, mode]
  );
  const selectedCandidate =
    (selectedCandidateId ? importCandidates[selectedCandidateId] ?? null : null) ?? candidates[0] ?? null;
  const candidateIds = useMemo(() => candidates.map((candidate) => candidate.id), [candidates]);
  const candidateRoving = useRovingFocus({
    ids: candidateIds,
    activeId: selectedCandidate?.id ?? null,
  });
  const readiness = selectedCandidate ? deriveStudioReadiness(selectedCandidate) : null;
  const importBlocked = selectedCandidate ? !canImportCandidate(selectedCandidate) : false;
  const liveCaptureNames = useMemo(() => extractCaptureNames(filePattern), [filePattern]);
  const readinessState = readiness?.state ?? null;
  const importLabel = getImportLabel(readinessState, importBlocked);
  const importFootnote = getImportFootnote(readinessState, importBlocked);

  // For table mode, show the wizard in steps 'load' and 'map',
  // and only show the candidate preview in step 'preview'
  const showTsvWizard = mode === 'table' && tsvWizardStep !== 'preview';
  // For table mode in preview step, or manifest/regex modes, show the classic layout
  const showClassicLayout = !showTsvWizard;

  const dialogTitle = mode === 'table'
    ? 'Import from table'
    : mode === 'manifest'
      ? 'Import NeuroTabs Manifest'
      : 'Discover files by regex';

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeImportDialog}
      title={dialogTitle}
      size="full"
      bodyClassName="p-0"
      className="max-w-4xl rounded-sm"
      // The Modal's footer slot sits outside the scrolling body, so the Import
      // action stays visible however tall the preview grows.
      footer={
        showClassicLayout ? (
          <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3">
            <div className="text-bf-sm text-muted-foreground">{importFootnote}</div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={closeImportDialog}>
                Cancel
              </Button>
              <Button
                onClick={confirmImportCandidate}
                disabled={!selectedCandidate || isLoading || importBlocked}
              >
                {importLabel}
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      <div style={{ maxHeight: 'calc(85vh - 4rem)' }} className="flex flex-col">
        <Tabs
          idBase={IMPORT_TABS_ID}
          aria-label="Import source"
          items={IMPORT_TABS.map((tab) => ({ value: tab.mode, label: tab.label }))}
          value={mode}
          onValueChange={(value) => openImportDialog(value as StudioImportMode)}
          className="border-b border-border bg-background px-4"
        />
        <div
          role="tabpanel"
          id={tabIds(IMPORT_TABS_ID, mode).panel}
          aria-labelledby={tabIds(IMPORT_TABS_ID, mode).tab}
          className="flex min-h-0 flex-1 flex-col"
        >
        {/* TSV wizard (load + map steps) */}
        {showTsvWizard ? (
          <div className="flex-1 overflow-y-auto p-5">
            <TsvImportWizard />
          </div>
        ) : null}

        {/* Classic two-column layout for manifest, regex, and table preview step */}
        {showClassicLayout ? (
          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
            <div className="border-r border-border bg-background p-4 overflow-y-auto">
              <div className="text-bf-md font-medium text-foreground">Preview candidates</div>
              <div
                role="listbox"
                aria-label="Preview candidates"
                onKeyDown={candidateRoving.onKeyDown}
                className="mt-3 space-y-2"
              >
                {candidates.map((candidate) => {
                  const isSelected = candidate.id === selectedCandidate?.id;
                  return (
                    <SelectableRow
                      key={candidate.id}
                      variant="card"
                      {...candidateRoving.getItemProps(candidate.id)}
                      selected={isSelected}
                      onSelect={() => selectImportCandidate(candidate.id)}
                    >
                      <div className="text-bf-md font-medium">{candidate.label}</div>
                      <div className="mt-1 text-bf-sm leading-5 text-muted-foreground">
                        {candidate.description}
                      </div>
                    </SelectableRow>
                  );
                })}
              </div>
            </div>

            <div className="bg-background flex flex-col overflow-hidden">
             <div className="flex-1 overflow-y-auto p-5">
              {mode !== 'table' ? (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-bf-sm text-muted-foreground">
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
                    <Notice role="alert" severity="danger" className="mb-4">
                      {error}
                    </Notice>
                  ) : null}

                  <div className="mb-4 rounded-sm border border-border bg-card p-4">
                    <div className="text-bf-md font-medium text-foreground">Preview request</div>
                    {mode === 'manifest' ? (
                      <div className="mt-3">
                        <FieldRow layout="stacked" label="Manifest path">
                          <TextField
                          value={manifestPath}
                          onChange={(event) => setManifestPath(event.target.value)}
                          placeholder="/path/to/study.neurotabs.yaml"
                        />
                        </FieldRow>
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <FieldRow layout="stacked" label="Discovery root">
                            <TextField
                            value={discoveryRoot}
                            onChange={(event) => setDiscoveryRoot(event.target.value)}
                            placeholder="."
                          />
                          </FieldRow>
                        </div>
                        <div>
                          <FieldRow layout="stacked" label="File pattern">
                            <TextField
                            value={filePattern}
                            onChange={(event) => setFilePattern(event.target.value)}
                            placeholder=".*_statmap\\.nii(\\.gz)?$"
                          />
                          </FieldRow>
                        </div>
                        <div>
                          <FieldRow layout="stacked" label="Max depth">
                            <TextField
                            value={discoveryMaxDepth}
                            onChange={(event) => setDiscoveryMaxDepth(event.target.value)}
                            inputMode="numeric"
                            placeholder="4"
                          />
                          </FieldRow>
                        </div>
                        <div>
                          <FieldRow layout="stacked" label="Max files">
                            <TextField
                            value={discoveryMaxFiles}
                            onChange={(event) => setDiscoveryMaxFiles(event.target.value)}
                            inputMode="numeric"
                            placeholder="500"
                          />
                          </FieldRow>
                        </div>
                      </div>
                    )}
                    {mode === 'regex' ? (
                      <div className="mt-4 space-y-4">
                        <FolderOntologyPreviewPanel
                          summary={ontologyPreview}
                          isLoading={isOntologyLoading}
                          error={ontologyError}
                          onApply={(candidateId) => {
                            applyFolderOntologyCandidate(candidateId);
                            void getSetIngestionService().openImportPreview('regex');
                          }}
                        />
                        <div>
                          <div className="text-bf-sm font-medium text-muted-foreground">Capture preview</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {liveCaptureNames.length > 0 ? (
                              liveCaptureNames.map((name) => (
                                <Chip key={name} mono>
                                  {name}
                                </Chip>
                              ))
                            ) : (
                              <span className="text-bf-sm text-muted-foreground">No named captures</span>
                            )}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-bf-md text-foreground">
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
                    <div className="text-bf-sm text-muted-foreground">
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
                    <Notice role="alert" severity="danger" className="mb-4">
                      {error}
                    </Notice>
                  ) : null}
                </>
              ) : null}

              {selectedCandidate ? (
                <ImportCandidatePreview candidate={selectedCandidate} readiness={readiness} />
              ) : (
                <div className="text-bf-md text-muted-foreground">No preview candidate available.</div>
              )}

             </div>
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </Modal>
  );
}

function FolderOntologyPreviewPanel({
  summary,
  isLoading,
  error,
  onApply,
}: {
  summary: StudioFolderOntologySummary | null;
  isLoading: boolean;
  error: string | null;
  onApply: (candidateId: string) => void;
}) {
  if (!summary && !isLoading && !error) {
    return null;
  }

  const candidates = summary?.candidates.slice(0, 4) ?? [];

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-bf-sm font-medium text-muted-foreground">Folder ontology</div>
        {summary ? (
          <div className="text-bf-sm text-muted-foreground">
            {summary.neuroimagingFiles} images · {summary.candidates.length} proposals
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-2 text-bf-md text-muted-foreground">Scanning folder…</div>
      ) : null}

      {error ? (
        <Notice role="alert" severity="danger" className="mt-2">
          {error}
        </Notice>
      ) : null}

      {summary?.warnings.length ? (
        <div className="mt-2 space-y-1">
          {summary.warnings.slice(0, 2).map((warning) => (
            <div key={`${warning.code}-${warning.message}`} className="text-bf-sm text-bf-warning">
              {warning.message}
            </div>
          ))}
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="mt-3 divide-y divide-border rounded-sm border border-border">
          {candidates.map((candidate) => (
            <FolderOntologyCandidateRow
              key={candidate.id}
              candidate={candidate}
              onApply={onApply}
            />
          ))}
        </div>
      ) : summary && !isLoading ? (
        <div className="mt-2 text-bf-md text-muted-foreground">No ontology proposals found.</div>
      ) : null}
    </div>
  );
}

function FolderOntologyCandidateRow({
  candidate,
  onApply,
}: {
  candidate: StudioFolderOntologyCandidate;
  onApply: (candidateId: string) => void;
}) {
  const roleLabel = candidate.observedRoles.length
    ? candidate.observedRoles.join(', ')
    : 'none';
  const factorLabel = candidate.factors.length
    ? candidate.factors.map((factor) => factor.name).join(', ')
    : 'none';

  return (
    <div className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-bf-md font-medium text-foreground">{candidate.label}</div>
          <Chip mono>{formatPercent(candidate.score)}</Chip>
        </div>
        <div className="mt-1 text-bf-sm text-muted-foreground">
          {candidate.matchedFiles} matched · {candidate.groups.length} groups · {candidate.duplicateKeys} dup · {candidate.missingRoleBindings} missing
        </div>
        <div className="mt-1 text-bf-sm text-muted-foreground">
          roles: {roleLabel} · factors: {factorLabel}
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => onApply(candidate.id)}>
        Apply
      </Button>
    </div>
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
        <div className="text-bf-md font-semibold text-foreground">{candidate.label}</div>
        <div className="mt-1 text-bf-md text-muted-foreground">{candidate.sourceHint}</div>
        <div className="mt-2 text-bf-md text-muted-foreground">{candidate.description}</div>
      </div>

      {readiness ? (
        <div className={`rounded-sm border p-4 ${readiness.className}`}>
          <div className="text-bf-sm font-medium">{readiness.eyebrow}</div>
          <div className="mt-2 text-bf-md font-medium">{readiness.title}</div>
          <div className="mt-1 text-bf-md">{readiness.message}</div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <PreviewCard
          title="Match summary"
          accent={set.ingestAudit.join.severity}
          rows={[
            ['Matched', String(set.ingestAudit.join.matchedRows)],
            ['Unmatched', String(set.ingestAudit.join.unmatchedRows)],
            ['Duplicate keys', String(set.ingestAudit.join.duplicateKeys)],
          ]}
        />
        <PreviewCard
          title="Template check"
          accent={set.ingestAudit.support.severity}
          rows={[
            ['Template', set.ingestAudit.support.supportLabel],
            ['Alignment', set.ingestAudit.support.alignmentClass],
            ['Compare ready', set.ingestAudit.support.readyForCompare ? 'Yes' : 'Not yet'],
          ]}
        />
        {set.seriesAxes && set.seriesAxes.length > 0 ? (
          <PreviewCard
            title="Series"
            accent="ok"
            rows={set.seriesAxes.map((axis, i): [string, string] => [
              set.seriesAxes!.length > 1 ? `Series axis ${i + 1}` : 'Series axis',
              seriesAxisLabel(axis, set.memberSummaries),
            ])}
          />
        ) : null}
        <PreviewCard
          title="Import contract"
          accent={candidate.contract.canImport ? 'ok' : 'error'}
          rows={[
            ['Status', formatContractReadiness(candidate.contract.readiness)],
            ['Provenance', formatProvenanceKind(candidate.contract.provenanceKind)],
            ['Capabilities', formatCapabilities(candidate.contract.capabilities)],
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
        <div className="rounded-sm border border-bf-warning/50 p-4">
          <div className="text-bf-md font-medium text-bf-warning">Import issues</div>
          <div className="mt-3 space-y-2">
            {set.ingestAudit.join.issueDetails.map((detail) => (
              <div
                key={`${detail.message}-${detail.memberIds.join('|')}`}
                className="text-bf-md text-foreground"
              >
                {detail.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-sm border border-border bg-card p-4">
        <div className="text-bf-md font-medium text-foreground">Metadata fields</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {set.designColumns.map((column) => (
            <span
              key={column}
              className="rounded-sm border border-border bg-background px-2.5 py-1 text-bf-sm text-muted-foreground"
            >
              {column}
            </span>
          ))}
        </div>
      </div>

      {set.designTablePreview?.rows.length ? (
        <div className="rounded-sm border border-border bg-card p-4">
          <div className="text-bf-md font-medium text-foreground">Preview rows</div>
          <div className="mt-3 overflow-hidden rounded-sm border border-border">
            <div
              className="grid gap-2 border-b border-border bg-background px-3 py-2 text-bf-xs text-muted-foreground"
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
                className="grid gap-2 border-t border-border px-3 py-2 text-bf-md text-foreground first:border-t-0"
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
        <div className="rounded-sm border border-border bg-card p-4">
          <div className="text-bf-md font-medium text-foreground">Import notes</div>
          <div className="mt-3 space-y-2">
            {set.ingestAudit.notes.map((note) => (
              <div key={note} className="text-bf-md text-muted-foreground">
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
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-bf-md font-medium text-foreground">NeuroTabs Export</div>
          <div className="mt-1 text-bf-sm text-muted-foreground">
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
          className={`mt-3 rounded-sm border px-3 py-2 text-bf-md ${
            status.state === 'error'
              ? 'border-destructive/40 bg-bf-danger-soft text-foreground'
              : 'border-bf-success/40 text-foreground'
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
      <div className="text-bf-sm font-medium text-muted-foreground">Role mapping</div>
      <div className="mt-2 overflow-hidden rounded-sm border border-border">
        <div className="grid grid-cols-[84px_minmax(0,1fr)_72px] gap-2 border-b border-border bg-background px-3 py-2 text-bf-xs text-muted-foreground">
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
              <div className="text-bf-md font-medium text-foreground">{entry.role}</div>
              <div className="flex min-w-0 gap-2">
                <TextField
                  aria-label={`${entry.role} patterns`}
                  className="min-w-0 flex-1"
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
        <TextField
          aria-label="Custom role"
          className="min-w-0 flex-1"
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
          Add role
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
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-bf-md font-medium text-foreground">Discovery matrix</div>
          <div className="mt-1 text-bf-sm text-muted-foreground">
            {discovery.matchedFiles} matched / {discovery.unmatchedFiles} unmatched / {discovery.duplicateKeys} duplicates
          </div>
        </div>
        {discovery.truncated ? (
          <span className="rounded-sm border border-bf-warning/50 px-2.5 py-1 text-bf-sm text-bf-warning">
            Truncated
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {discovery.captureNames.map((name) => (
          <span
            key={name}
            className="rounded-sm border border-border bg-background px-2.5 py-1 text-bf-sm text-muted-foreground"
          >
            {name}
          </span>
        ))}
      </div>

      {roles.length > 0 && shownGroups.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[520px] border-collapse text-left text-bf-md">
            <thead className="bg-background text-bf-xs text-muted-foreground">
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
        <div className="mt-2 text-bf-sm text-muted-foreground">
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
    ? 'border-bf-warning/50 text-bf-warning'
    : missing
      ? 'border-destructive/40 text-bf-danger'
      : 'border-bf-success/40 text-bf-success';
  const title = matching.map((binding) => binding.relativePath).join('\n');

  return (
    <span
      className={`inline-flex min-w-[64px] justify-center rounded-sm border px-2 py-1 text-bf-sm ${className}`}
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
  if (candidate.contract.readiness === 'compare_ready') {
    return {
      state: 'ready' as const,
      eyebrow: 'Studio ready',
      title: 'Ready for compare-centered reading',
      message: candidate.contract.reason,
      className: 'border-bf-success/40 bg-card text-foreground',
    };
  }

  if (candidate.contract.readiness === 'inspect_only') {
    return {
      state: 'inspect' as const,
      eyebrow: 'Audit attention',
      title: 'Import for inspection first',
      message: candidate.contract.reason,
      className: 'border-destructive/40 bg-bf-danger-soft text-foreground',
    };
  }

  if (candidate.contract.readiness === 'blocked') {
    return {
      state: 'blocked' as const,
      eyebrow: 'Import blocked',
      title: 'Fix preview errors before import',
      message: candidate.contract.reason,
      className: 'border-destructive/40 bg-bf-danger-soft text-foreground',
    };
  }

  return {
    state: 'review' as const,
    eyebrow: 'Deck first',
    title: 'Import for review before compare',
    message: candidate.contract.reason,
    className: 'border-bf-warning/50 bg-card text-foreground',
  };
}

function getImportLabel(
  readinessState: 'ready' | 'review' | 'inspect' | 'blocked' | null,
  importBlocked: boolean
): string {
  if (importBlocked) {
    return 'Import blocked';
  }
  if (readinessState === 'ready') {
    return 'Import for compare';
  }
  if (readinessState === 'review') {
    return 'Import for review';
  }
  if (readinessState === 'inspect') {
    return 'Import for inspection';
  }
  return 'Import into studio';
}

function getImportFootnote(
  readinessState: 'ready' | 'review' | 'inspect' | 'blocked' | null,
  importBlocked: boolean
): string {
  if (readinessState === 'ready') {
    return 'Studio will open this set ready for Compare.';
  }
  if (readinessState === 'review') {
    return 'Studio will open this set in Deck so you can review warnings first.';
  }
  if (readinessState === 'inspect') {
    return 'Studio will import this set for inspection, not trusted compare reading.';
  }
  if (readinessState === 'blocked') {
    return importBlocked
      ? 'Fix the preview errors before importing this set.'
      : 'Studio will import this set for inspection, not trusted compare reading.';
  }
  return 'Studio will import the selected preview candidate.';
}

function formatContractToken(value: string): string {
  return value
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function formatContractReadiness(readiness: StudioImportCandidate['contract']['readiness']): string {
  return formatContractToken(readiness);
}

function formatProvenanceKind(kind: StudioImportCandidate['contract']['provenanceKind']): string {
  return formatContractToken(kind);
}

function formatCapabilities(capabilities: StudioImportCandidate['contract']['capabilities']): string {
  if (capabilities.length === 0) {
    return 'None';
  }
  return capabilities.map(formatContractToken).join(', ');
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
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
      ? 'border-border'
      : accent === 'warning'
        ? 'border-border'
        : 'border-destructive/40';

  return (
    <div className={`rounded-sm border bg-card p-4 ${accentClass}`}>
      <div className="text-bf-md font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-bf-md">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
