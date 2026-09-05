import React, { useEffect, useRef, useState } from 'react';
import type { ParcelTablePreview, ParcelTableRequest } from '@brainflow/api';
import {
  surfaceParcelOverlayService,
  type SurfaceParcelTarget,
} from '@/services/SurfaceParcelOverlayService';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import {
  parcelBindingMessage,
  parcelMetricColumns,
  suggestParcelIdColumn,
} from '@/services/parcelTablePresentation';

const fieldClass = 'bf-select w-full';
const keyKinds: Record<string, string> = {
  id: 'Atlas integer ID',
  full_label: 'Full source label',
  label: 'Exact label',
  label_hemi: 'Label + hemisphere',
  label_hemi_network: 'Label + hemisphere + network',
};
export function parcelError(error: unknown): string {
  if (error && typeof error === 'object' && 'details' in error) return String(error.details);
  return error instanceof Error ? error.message : String(error);
}

export function ParcelTableImport({
  sourceVolumeId = '',
  surfaceTarget,
  atlasName,
  onClose,
}: {
  sourceVolumeId?: string;
  surfaceTarget?: SurfaceParcelTarget;
  atlasName: string;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [tableName, setTableName] = useState('Parcel values');
  const [delimiter, setDelimiter] = useState(',');
  const [keyColumn, setKeyColumn] = useState('');
  const [keyKind, setKeyKind] = useState('id');
  const [hemisphereColumn, setHemisphereColumn] = useState('');
  const [networkColumn, setNetworkColumn] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [column, setColumn] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [preview, setPreview] = useState<ParcelTablePreview | null>(null);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileGeneration = useRef(0);
  const mappingEdited = useRef(false);
  useEffect(
    () => () => {
      fileGeneration.current++;
    },
    [],
  );

  const usesHemisphere = keyKind === 'label_hemi' || keyKind === 'label_hemi_network';
  const usesNetwork = keyKind === 'label_hemi_network';
  const request: ParcelTableRequest = {
    sourceVolumeId,
    text,
    delimiter,
    keyColumn: keyColumn || null,
    keyKind,
    hemisphereColumn: usesHemisphere ? hemisphereColumn || null : null,
    networkColumn: usesNetwork ? networkColumn || null : null,
    allowPartial,
  };
  // Every mapping change, including an automatic suggestion, needs a new receipt.
  const requestKey = JSON.stringify(request);
  const targetKey = JSON.stringify(surfaceTarget ?? null);
  const bindingKey = `${targetKey}|${requestKey}`;
  const [validatedKey, setValidatedKey] = useState('');
  useEffect(() => {
    let cancelled = false;
    setValidationError('');
    if (!text) {
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const currentRequest = JSON.parse(requestKey) as ParcelTableRequest;
      const currentTarget = JSON.parse(targetKey) as SurfaceParcelTarget | null;
      const validation = currentTarget
        ? surfaceParcelOverlayService.preview(currentTarget, currentRequest)
        : parcelOverlayService.preview(currentRequest);
      validation
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setValidatedKey(bindingKey);
          const suggested =
            !mappingEdited.current && !currentRequest.keyColumn
              ? suggestParcelIdColumn(result.headers)
              : null;
          if (suggested) {
            setKeyColumn(suggested);
            setKeyKind('id');
            return; // The suggested mapping must itself be validated first.
          }
          if (result.bindingError) {
            setMappingOpen(true);
            return;
          }
          const metrics = parcelMetricColumns(result.columns, [
            currentRequest.keyColumn,
            currentRequest.hemisphereColumn,
            currentRequest.networkColumn,
          ]).filter((c) => c.range && !c.error);
          setColumn((previous) =>
            metrics.some((c) => c.name === previous) ? previous : (metrics[0]?.name ?? ''),
          );
        })
        .catch((e) => {
          if (!cancelled) {
            setValidationError(parcelError(e));
            setPreview(null);
            setMappingOpen(true);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [requestKey, targetKey, bindingKey, text]);

  const metrics = parcelMetricColumns(preview?.columns ?? [], [
    request.keyColumn,
    request.hemisphereColumn,
    request.networkColumn,
  ]);
  const hasMetric = metrics.some((c) => c.range && !c.error);
  const selected = metrics.find((c) => c.name === column);
  const current = validatedKey === bindingKey && !loading;
  const bindingError = current ? preview?.bindingError : null;
  const problem = error || validationError || bindingError;
  const message = problem ? parcelBindingMessage(problem) : null;
  const canCreate =
    current &&
    !creating &&
    !validationError &&
    !bindingError &&
    !!preview &&
    !!selected?.range &&
    !selected.error;

  function replaceTable(content: string, name: string, separator: string) {
    mappingEdited.current = false;
    setText(content);
    setTableName(name);
    setDelimiter(separator);
    setKeyColumn('');
    setKeyKind('id');
    setHemisphereColumn('');
    setNetworkColumn('');
    setAllowPartial(false);
    setColumn('');
    setPreview(null);
    setValidatedKey('');
    setMappingOpen(false);
    setError('');
  }
  const columnSelect = (label: string, value: string, setValue: (s: string) => void) => (
    <label className="block space-y-1">
      <span>{label}</span>
      <select
        className={fieldClass}
        value={value}
        onChange={(e) => {
          mappingEdited.current = true;
          setValue(e.target.value);
        }}
      >
        <option value="">Choose a column</option>
        {preview?.headers.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label="Add parcel values" className="bf-parcel-form space-y-3 py-2 text-[12px]">
      <p className="text-muted-foreground leading-relaxed">
        Target: <span className="text-foreground">{atlasName}</span>
      </p>
      {surfaceTarget && (
        <p className="text-[11px] text-muted-foreground">
          Applies to both hemispheres when present.
        </p>
      )}
      <fieldset disabled={creating} className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <input
            ref={fileInput}
            aria-label="CSV or TSV file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // Allow reloading the same file after an error.
              if (!file) return;
              const generation = ++fileGeneration.current;
              replaceTable('', file.name, file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',');
              if (file.size > 5 * 1024 * 1024) {
                setError('Table exceeds the 5 MiB import limit.');
                return;
              }
              try {
                const content = await file.text();
                if (generation === fileGeneration.current) setText(content);
              } catch (e) {
                if (generation === fileGeneration.current) setError(parcelError(e));
              }
            }}
          />
          <button
            type="button"
            className="bf-control-button shrink-0"
            onClick={() => fileInput.current?.click()}
          >
            {text ? 'Replace table…' : 'Choose table…'}
          </button>
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={text ? tableName : undefined}
          >
            {text ? tableName : 'CSV or TSV'}
          </span>
        </div>
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Paste a table</summary>
          <textarea
            aria-label="Table text"
            className="mt-2 h-24 w-full rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground"
            value={text}
            onChange={(e) => {
              fileGeneration.current++;
              const content = e.target.value;
              replaceTable(
                content,
                'Parcel values',
                content.split('\n')[0].includes('\t') ? '\t' : ',',
              );
            }}
          />
        </details>
        {text && (
          <>
            {keyColumn && (
              <p className="text-[11px] text-muted-foreground break-words">
                Matching <span className="font-mono text-foreground">{keyColumn}</span> →{' '}
                {keyKinds[keyKind]}
              </p>
            )}
            <label className="block space-y-1">
              <span>Display column</span>
              <select
                className={fieldClass}
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                <option value="">Choose a numeric column</option>
                {metrics.map((c) => (
                  <option key={c.name} value={c.name} disabled={!!c.error || !c.range}>
                    {c.name}
                    {c.error ? ' (invalid values)' : !c.range ? ' (no values)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {current && preview && !bindingError && !hasMetric && (
              <p className="text-[11px] text-destructive" role="status">
                {metrics.find((c) => c.error)?.error ??
                  'No numeric display values found. Add a metric column to the table.'}
              </p>
            )}
            {current && selected?.range && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Range {selected.range[0].toLocaleString()} to {selected.range[1].toLocaleString()} ·{' '}
                {selected.missingCount} missing cells
              </p>
            )}
            {current && preview && !bindingError && (
              <p role="status" className="text-[11px] text-muted-foreground">
                <span className="text-foreground">
                  {preview.matchedParcels}/{preview.atlasParcels} parcels matched
                </span>
                {preview.missingParcels > 0 &&
                  ` · ${preview.missingParcels} unmatched (transparent)`}
              </p>
            )}
            <details
              open={mappingOpen}
              onToggle={(e) => {
                const open = e.currentTarget.open;
                if (open !== mappingOpen) setMappingOpen(open);
              }}
              className="border-t border-border/60 pt-2"
            >
              <summary className="cursor-pointer text-muted-foreground">Mapping options</summary>
              <div className="mt-3 space-y-3">
                <label className="block space-y-1">
                  <span>Match parcels using</span>
                  <select
                    className={fieldClass}
                    value={keyKind}
                    onChange={(e) => {
                      mappingEdited.current = true;
                      setKeyKind(e.target.value);
                    }}
                  >
                    {Object.entries(keyKinds).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {columnSelect('Parcel key column', keyColumn, setKeyColumn)}
                {usesHemisphere &&
                  columnSelect(
                    'Hemisphere column (left / right / both)',
                    hemisphereColumn,
                    setHemisphereColumn,
                  )}
                {usesNetwork && columnSelect('Network column', networkColumn, setNetworkColumn)}
                <label className="block space-y-1">
                  <span>Delimiter</span>
                  <select
                    className={fieldClass}
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value)}
                  >
                    <option value=",">Comma (CSV)</option>
                    <option value={'\t'}>Tab (TSV)</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={allowPartial}
                    onChange={(e) => setAllowPartial(e.target.checked)}
                  />
                  Allow unmatched parcels (transparent)
                </label>
                {preview && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer">
                      Expected keys · {preview.atlasParcels} parcels
                    </summary>
                    <ul className="mt-2 space-y-1 break-words">
                      {preview.keyExamples.map((example) => (
                        <li key={example}>{example}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Keys must match this atlas exactly; row order is ignored. Blank, NA and null cells
                  are missing. Zero is a value.
                </p>
              </div>
            </details>
          </>
        )}
      </fieldset>
      {loading && (
        <p role="status" className="text-[11px] text-muted-foreground">
          Checking atlas keys…
        </p>
      )}
      {message && (
        <div role="alert" className="space-y-1 text-[12px] leading-relaxed">
          <p className="text-destructive">{message.message}</p>
          {message.detail && (
            <details className="text-[11px] text-muted-foreground break-words">
              <summary className="cursor-pointer">Details</summary>
              <p className="mt-1">{message.detail}</p>
            </details>
          )}
        </div>
      )}
      <div className="flex gap-2 border-t border-border/60 pt-3">
        <button
          type="button"
          className="bf-control-button bf-control-button-primary flex-1"
          disabled={!canCreate}
          onClick={async () => {
            setCreating(true);
            setError('');
            try {
              if (surfaceTarget)
                await surfaceParcelOverlayService.create(surfaceTarget, request, column, tableName);
              else await parcelOverlayService.create(request, column, tableName);
              onClose();
            } catch (e) {
              setError(parcelError(e));
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? 'Creating…' : 'Create overlay'}
        </button>
        <button type="button" className="bf-control-button" disabled={creating} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}
