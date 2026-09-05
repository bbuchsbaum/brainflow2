import React, { useEffect, useRef, useState } from 'react';
import type { ParcelTablePreview, ParcelTableRequest } from '@brainflow/api';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import { Button } from '../ui/Button';

const fieldClass = 'w-full rounded border border-border bg-background px-2 py-1.5 text-sm';
export function parcelError(error: unknown): string {
  if (error && typeof error === 'object' && 'details' in error) return String(error.details);
  return error instanceof Error ? error.message : String(error);
}

export function ParcelTableImport({
  sourceVolumeId,
  atlasName,
  onClose,
}: {
  sourceVolumeId: string;
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
  const [preview, setPreview] = useState<ParcelTablePreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileGeneration = useRef(0);
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
  // Fingerprint the complete input, including mapping and coverage policy. A
  // previous validation result is never usable after an input change.
  const requestKey = JSON.stringify(request);
  const [validatedKey, setValidatedKey] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!text) {
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      parcelOverlayService
        .preview(JSON.parse(requestKey) as ParcelTableRequest)
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setValidatedKey(requestKey);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(parcelError(e));
            setPreview(null);
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
  }, [requestKey, text]);

  const selected = preview?.columns.find((c) => c.name === column);
  const canCreate =
    validatedKey === requestKey &&
    !loading &&
    !creating &&
    !preview?.bindingError &&
    !!selected?.range &&
    !selected.error;
  const columnSelect = (label: string, value: string, setValue: (s: string) => void) => (
    <label className="block space-y-1 text-sm">
      {label}
      <select className={fieldClass} value={value} onChange={(e) => setValue(e.target.value)}>
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
    <section aria-label="Add parcel values" className="space-y-3 rounded border border-border p-3">
      <p className="text-sm font-medium">Add parcel values</p>
      <p className="text-xs text-muted-foreground">
        Target: {atlasName}. Keys will be checked against this loaded atlas.
      </p>
      <fieldset disabled={creating} className="space-y-3 min-w-0">
        <label className="block text-sm">
          CSV or TSV file
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="mt-1 w-full text-xs"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const generation = ++fileGeneration.current;
              setText('');
              setKeyColumn('');
              setColumn('');
              if (file.size > 5 * 1024 * 1024) {
                setError('Table exceeds the 5 MiB import limit');
                return;
              }
              try {
                const content = await file.text();
                if (generation !== fileGeneration.current) return;
                setTableName(file.name);
                setDelimiter(file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',');
                setText(content);
              } catch (e) {
                if (generation === fileGeneration.current) setError(parcelError(e));
              }
            }}
          />
        </label>
        <details>
          <summary className="text-xs cursor-pointer">Or paste a table</summary>
          <label className="block text-xs mt-2">
            Table text
            <textarea
              aria-label="Table text"
              className={`${fieldClass} h-28 font-mono`}
              value={text}
              onChange={(e) => {
                fileGeneration.current++;
                setText(e.target.value);
              }}
            />
          </label>
        </details>
        {text && (
          <>
            <label className="block space-y-1 text-sm">
              Delimiter
              <select
                className={fieldClass}
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value=",">Comma (CSV)</option>
                <option value={'\t'}>Tab (TSV)</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              Match parcels using
              <select
                className={fieldClass}
                value={keyKind}
                onChange={(e) => setKeyKind(e.target.value)}
              >
                <option value="id">Atlas integer ID</option>
                <option value="full_label">Full source label</option>
                <option value="label">Exact label</option>
                <option value="label_hemi">Label + hemisphere</option>
                <option value="label_hemi_network">Label + hemisphere + network</option>
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
            <label className="flex gap-2 items-start text-xs">
              <input
                type="checkbox"
                checked={allowPartial}
                onChange={(e) => setAllowPartial(e.target.checked)}
              />
              Allow a partial atlas; unmatched parcels stay transparent
            </label>
            {preview && (
              <details className="text-xs">
                <summary className="cursor-pointer">
                  Expected keys · {preview.atlasParcels} parcels
                </summary>
                <ul className="mt-1 space-y-1 break-words">
                  {preview.keyExamples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </details>
            )}
            {preview && !loading && validatedKey === requestKey && (
              <div role="status" className="text-xs space-y-1">
                {preview.bindingError ? (
                  <p className="text-destructive">{preview.bindingError}</p>
                ) : (
                  <p>
                    {preview.matchedParcels} of {preview.atlasParcels} parcels matched ·{' '}
                    {preview.missingParcels} absent
                  </p>
                )}
              </div>
            )}
            <label className="block space-y-1 text-sm">
              Display column
              <select
                className={fieldClass}
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                <option value="">Choose a numeric column</option>
                {preview?.columns.map((c) => (
                  <option key={c.name} value={c.name} disabled={!!c.error}>
                    {c.name}
                    {c.error ? ` — ${c.error}` : ` (${c.finiteCount} values)`}
                  </option>
                ))}
              </select>
            </label>
            {selected?.range && (
              <p className="text-xs text-muted-foreground">
                Range {selected.range[0]} to {selected.range[1]} · {selected.missingCount} missing
                cells
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Blank, NA and null cells are missing. Zero is a value. Names are exact; row order is
              ignored.
            </p>
          </>
        )}
      </fieldset>
      {loading && (
        <p role="status" className="text-xs">
          Checking table…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canCreate}
          loading={creating}
          onClick={async () => {
            setCreating(true);
            setError('');
            try {
              await parcelOverlayService.create(request, column, tableName);
              onClose();
            } catch (e) {
              setError(parcelError(e));
            } finally {
              setCreating(false);
            }
          }}
        >
          Create overlay
        </Button>
        <Button size="sm" variant="secondary" disabled={creating} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
