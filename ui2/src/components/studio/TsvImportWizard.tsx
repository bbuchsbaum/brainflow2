import React, { useCallback, useRef } from 'react';
import { Button, Chip, FieldRow, FilterChip, Select } from '@/components/ui/bf';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';

export function TsvImportWizard() {
  const wizard = useSetStudioStore((s) => s.importDialog.tsvWizard);
  const parseTsvContent = useSetStudioStore((s) => s.parseTsvContent);
  const setTsvPath = useSetStudioStore((s) => s.setTsvPath);
  const setTsvColumnMapping = useSetStudioStore((s) => s.setTsvColumnMapping);
  const setTsvWizardStep = useSetStudioStore((s) => s.setTsvWizardStep);
  const isLoading = useSetStudioStore((s) => s.importDialog.isLoading);

  if (wizard.step === 'load') {
    return (
      <TsvLoadStep
        tsvPath={wizard.tsvPath}
        parseError={wizard.parseError}
        onPathChange={setTsvPath}
        onContentLoaded={parseTsvContent}
      />
    );
  }

  if (wizard.step === 'map') {
    return (
      <TsvMapStep
        headers={wizard.headers}
        rows={wizard.rows}
        columnMapping={wizard.columnMapping}
        onMappingChange={setTsvColumnMapping}
        onBack={() => setTsvWizardStep('load')}
        isLoading={isLoading}
        onNext={() => {
          void getSetIngestionService().validateTablePreview();
        }}
      />
    );
  }

  // step === 'preview' is handled by the parent dialog (shows ImportCandidatePreview)
  return null;
}

function TsvLoadStep({
  tsvPath,
  parseError,
  onPathChange,
  onContentLoaded,
}: {
  tsvPath: string;
  parseError: string | null;
  onPathChange: (path: string) => void;
  onContentLoaded: (content: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      onPathChange(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text === 'string') {
          onContentLoaded(text);
        }
      };
      reader.readAsText(file);
    },
    [onPathChange, onContentLoaded]
  );

  const handlePaste = useCallback(() => {
    const text = textAreaRef.current?.value?.trim();
    if (text) {
      onPathChange('pasted content');
      onContentLoaded(text);
    }
  }, [onPathChange, onContentLoaded]);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-bf-md font-medium text-foreground">Load a table file</div>
        <div className="mt-1 text-bf-md text-muted-foreground">
          Select a TSV or CSV file with one row per subject. It should have columns for file paths,
          subject IDs, and any design variables (diagnosis, age, site, etc.).
        </div>
      </div>

      <div className="rounded-sm border border-border bg-card p-4">
        <div className="text-bf-md font-medium text-foreground">Browse for file</div>
        <div className="mt-3 flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".tsv,.csv,.txt,.tab"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose File...
          </Button>
          {tsvPath && tsvPath !== 'pasted content' ? (
            <span className="text-bf-md text-muted-foreground truncate">{tsvPath}</span>
          ) : null}
        </div>
      </div>

      <div className="rounded-sm border border-border bg-card p-4">
        <div className="text-bf-md font-medium text-foreground">Or paste table content</div>
        <textarea
          ref={textAreaRef}
          className="mt-3 w-full rounded-sm border border-border bg-background px-3 py-2 text-bf-md text-foreground font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={6}
          placeholder={'subject\tfile\tdiagnosis\tsex\tage\nsub001\t/data/sub001_stat.nii.gz\tcontrol\tF\t25\nsub002\t/data/sub002_stat.nii.gz\tpatient\tM\t32'}
        />
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" size="sm" onClick={handlePaste}>
            Parse pasted content
          </Button>
        </div>
      </div>

      {parseError ? (
        <div className="rounded-sm border border-destructive/40 bg-bf-danger-soft px-3 py-2 text-bf-md text-foreground">
          {parseError}
        </div>
      ) : null}
    </div>
  );
}

function TsvMapStep({
  headers,
  rows,
  columnMapping,
  onMappingChange,
  onBack,
  onNext,
  isLoading,
}: {
  headers: string[];
  rows: string[][];
  columnMapping: { filePathColumn: string | null; subjectIdColumn: string | null; excludedColumns: string[] };
  onMappingChange: (mapping: Partial<typeof columnMapping>) => void;
  onBack: () => void;
  onNext: () => void;
  isLoading: boolean;
}) {
  const canProceed = columnMapping.filePathColumn && columnMapping.subjectIdColumn;
  const designColumns = headers.filter(
    (h) =>
      h !== columnMapping.filePathColumn &&
      h !== columnMapping.subjectIdColumn &&
      !columnMapping.excludedColumns.includes(h)
  );

  // Show up to 5 preview rows with up to 5 columns
  const previewCols = headers.slice(0, 5);
  const previewRows = rows.slice(0, 5);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-bf-md font-medium text-foreground">Map columns</div>
        <div className="mt-1 text-bf-md text-muted-foreground">
          Tell Studio which column has the file paths and which has the subject IDs.
          All other columns become design variables automatically.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-sm border border-border bg-card p-4">
          <FieldRow layout="stacked" label="File path column">
            <Select
            value={columnMapping.filePathColumn ?? ''}
            onChange={(e) => onMappingChange({ filePathColumn: e.target.value || null })}
          >
            <option value="">Select column...</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
          </FieldRow>
        </div>

        <div className="rounded-sm border border-border bg-card p-4">
          <FieldRow layout="stacked" label="Subject ID Column">
            <Select
            value={columnMapping.subjectIdColumn ?? ''}
            onChange={(e) => onMappingChange({ subjectIdColumn: e.target.value || null })}
          >
            <option value="">Select column...</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
          </FieldRow>
        </div>
      </div>

      <div className="rounded-sm border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-bf-md font-medium text-foreground">
            Design variables ({designColumns.length})
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {headers
            .filter((h) => h !== columnMapping.filePathColumn)
            .map((h) => {
              const excluded = columnMapping.excludedColumns.includes(h);
              const isSubjectId = h === columnMapping.subjectIdColumn;
              return isSubjectId ? (
                  <Chip key={h}>{h} (ID)</Chip>
                ) : (
                  <FilterChip
                    key={h}
                    pressed={!excluded}
                    onPressedChange={() => {
                      const next = excluded
                        ? columnMapping.excludedColumns.filter((c) => c !== h)
                        : [...columnMapping.excludedColumns, h];
                      onMappingChange({ excludedColumns: next });
                    }}
                    className={excluded ? 'line-through' : undefined}
                  >
                    {h}
                  </FilterChip>
                );
            })}
        </div>
        <div className="mt-2 text-bf-sm text-muted-foreground">
          Click to exclude columns from design variables.
        </div>
      </div>

      <div className="rounded-sm border border-border bg-card p-4">
        <div className="text-bf-md font-medium text-foreground">Preview ({rows.length} rows total)</div>
        <div className="mt-3 overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-bf-md">
            <thead>
              <tr className="border-b border-border bg-background">
                {previewCols.map((col) => (
                  <th
                    key={col}
                    className={`px-3 py-2 text-left text-bf-xs font-medium text-muted-foreground ${
                      col === columnMapping.filePathColumn
                        ? 'bg-bf-bg-active'
                        : col === columnMapping.subjectIdColumn
                          ? 'bg-bf-bg-hover'
                          : ''
                    }`}
                  >
                    {col}
                    {col === columnMapping.filePathColumn ? ' (file)' : ''}
                    {col === columnMapping.subjectIdColumn ? ' (ID)' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, ri) => (
                <tr key={ri} className="border-t border-border first:border-t-0">
                  {previewCols.map((col, ci) => {
                    const idx = headers.indexOf(col);
                    return (
                      <td
                        key={ci}
                        className={`px-3 py-2 text-foreground ${
                          col === columnMapping.filePathColumn
                            ? 'bg-bf-bg-active font-mono text-bf-sm'
                            : col === columnMapping.subjectIdColumn
                              ? 'bg-bf-bg-hover'
                              : ''
                        }`}
                      >
                        {idx >= 0 ? row[idx] ?? '' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed || isLoading}>
          {isLoading ? 'Validating...' : 'Validate & Preview'}
        </Button>
      </div>
    </div>
  );
}
