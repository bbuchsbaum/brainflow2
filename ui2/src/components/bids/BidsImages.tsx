/** The BIDS contact sheet: one named series and one shared display window. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BidsSliceImage, BidsSliceRequest } from '@brainflow/api';
import { NumberField, SegmentedControl, Select } from '@/components/ui/bf';
import { useBidsResource } from '@/hooks/useBidsResource';
import { fetchSlice, formatZ, isImageUnavailable } from '@/components/inspector/bids/bidsSlices';
import { openRunInViewer } from '@/services/bids/openRunInViewer';
import { GHOST_CEILING, naturalCompare, runLabel, seriesLabel, type BidsRunFacts } from '@/stores/bidsModel';
import { useBidsModel, useBidsStore, type BidsImageReference } from '@/stores/bidsStore';
import { cn } from '@/utils/cn';
import { formatTauriError } from '@/utils/formatTauriError';

type ImageKind = BidsImageReference['kind'];
type Sort = 'matrix' | 'tsnr' | 'fd';
const KINDS: ReadonlyArray<{ value: ImageKind; label: string }> = [
  { value: 'mean', label: 'Mean EPI' },
  { value: 'anat', label: 'T1w' },
  { value: 'b0', label: 'b0' },
  { value: 'tsnr', label: 'tSNR map' },
];
const supports = ({ run }: BidsRunFacts, kind: ImageKind) =>
  kind === 'anat' ? run.suffix === 'T1w' : kind === 'b0' ? run.suffix === 'dwi' : run.suffix === 'bold';
const groupOf = (series: string, run: string | null) => JSON.stringify([series, run]);
const groupKey = ({ run }: BidsRunFacts) => groupOf(run.series, run.run);

/** Bound in-flight thumbnails; queued work is discarded as tiles leave view. */
function makeSliceQueue() {
  type Job = {
    request: BidsSliceRequest;
    cancelled: boolean;
    resolve: (image: BidsSliceImage | null) => void;
    reject: (error: unknown) => void;
  };
  const pending: Job[] = [];
  let running = 0;
  const pump = () => {
    while (running < 2 && pending.length) {
      const job = pending.shift()!;
      if (job.cancelled) continue;
      running += 1;
      void fetchSlice(job.request).then(
        (image) => job.resolve(job.cancelled ? null : image),
        (error: unknown) => job.cancelled ? job.resolve(null) : job.reject(error),
      ).finally(() => { running -= 1; pump(); });
    }
  };
  return {
    add(request: BidsSliceRequest) {
      let job!: Job;
      const promise = new Promise<BidsSliceImage | null>((resolve, reject) => {
        job = { request, cancelled: false, resolve, reject };
        pending.push(job);
        pump();
      });
      return { promise, cancel: () => { job.cancelled = true; job.resolve(null); } };
    },
  };
}
type SliceQueue = ReturnType<typeof makeSliceQueue>;

function ImageTile({
  facts, selected, highlighted, reference, queue, scroller, sort,
}: {
  facts: BidsRunFacts;
  selected: boolean;
  highlighted: boolean;
  reference: BidsImageReference;
  queue: SliceQueue;
  scroller: React.RefObject<HTMLDivElement | null>;
  sort: Sort;
}) {
  const selectRun = useBidsStore((state) => state.selectRun);
  const target = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; image: BidsSliceImage | null; error: string | null } | null>(null);
  const request = useMemo<BidsSliceRequest>(() => ({
    path: facts.run.path,
    kind: reference.kind,
    world_z_mm: reference.worldZ,
    max_px: 160,
    window: reference.window,
    ...(reference.kind === 'b0' ? { dataset_root: reference.datasetPath } : {}),
  }), [facts.run.path, reference]);
  const key = `${reference.datasetPath}|${JSON.stringify(request)}`;
  const unavailable = isImageUnavailable(facts.run);

  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: scroller.current, rootMargin: '120px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    if (!visible || unavailable) return;
    let live = true;
    const job = queue.add(request);
    void job.promise.then((image) => {
      if (live && image) setResult({ key, image, error: null });
    }, (error: unknown) => {
      if (live) setResult({ key, image: null, error: formatTauriError(error) });
    });
    return () => { live = false; job.cancel(); };
  }, [visible, unavailable, queue, key, request]);

  const shown = result?.key === key ? result : null;
  const quality = facts.overThreshold || facts.tsnrOutlier !== null || (facts.ghost !== null && facts.ghost > GHOST_CEILING);
  const metric = sort === 'fd'
    ? facts.meanFd === null ? 'FD unavailable' : `FD ${facts.meanFd.toFixed(2)} mm`
    : facts.tsnr === null ? 'tSNR unavailable' : `tSNR ${Math.round(facts.tsnr)}`;
  return (
    <button
      ref={target}
      type="button"
      aria-label={runLabel(facts.run)}
      aria-pressed={selected}
      onClick={() => selectRun(facts.run.id)}
      onDoubleClick={() => void openRunInViewer(facts.run)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void openRunInViewer(facts.run); }
      }}
      className={cn('min-w-0 cursor-pointer border-0 border-t border-transparent bg-transparent p-0.5 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent',
        selected ? 'border-bf-accent bg-bf-bg-selected' : highlighted && 'bg-bf-bg-selected')}
      data-testid="bids-image-tile"
      data-run={facts.run.id}
      data-quality={quality || undefined}
      data-variant={facts.variantKey !== null || undefined}
    >
      <span className={cn('flex aspect-square items-center justify-center overflow-hidden bg-bf-bg-canvas',
        quality ? 'border border-bf-text-primary' : facts.variantKey !== null ? 'border border-bf-text-faint' : 'border border-transparent')}>
        {unavailable ? <span className="px-1 text-center text-bf-2xs text-bf-text-muted">Image unavailable</span>
          : shown?.error ? <span className="px-1 text-center text-bf-2xs text-bf-text-muted" title={shown.error}>Could not load</span>
            : shown?.image ? <img className="h-full w-full object-contain" alt="" src={`data:image/png;base64,${shown.image.png_base64}`} />
              : <span className="text-bf-2xs text-bf-text-faint">{visible ? 'Loading…' : ''}</span>}
      </span>
      <span className={cn('block truncate px-0.5 py-0.5 text-center font-mono text-bf-2xs text-bf-text-muted',
        selected && 'bg-bf-text-primary text-bf-text-inverse')} title={runLabel(facts.run)}>
        {facts.subjectLabel.replace(/^sub-/, '')}{facts.run.session ? ` · ${facts.run.session.replace(/^ses-/, '')}` : ''}
      </span>
      <span className="block truncate text-center font-mono text-bf-2xs text-bf-text-faint">{metric}</span>
    </button>
  );
}

export function BidsImages() {
  const model = useBidsModel();
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const selectedId = useBidsStore((state) => state.selectedRunId);
  const selectRun = useBidsStore((state) => state.selectRun);
  const setReference = useBidsStore((state) => state.setImageReference);
  const selected = selectedId ? model.runsById.get(selectedId) : undefined;
  const [kind, setKind] = useState<ImageKind>(() => selected?.run.suffix === 'T1w' ? 'anat' : selected?.run.suffix === 'dwi' ? 'b0' : 'mean');
  const [seriesKey, setSeriesKey] = useState('');
  const [sort, setSort] = useState<Sort>('matrix');
  const [requestedZ, setRequestedZ] = useState<number | null>(null);
  const queue = useMemo(makeSliceQueue, []);
  const scroller = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const live = useMemo(() => model.runs.filter((item) => !item.excluded &&
    !(model.lens.lens && model.lens.mode === 'only' && !item.inLens)), [model]);
  const available = KINDS.filter((entry) => live.some((item) => supports(item, entry.value)));
  const currentKind = available.some((entry) => entry.value === kind) ? kind : (available[0]?.value ?? kind);
  const options = useMemo(() => {
    const groups = new Map<string, BidsRunFacts>();
    for (const item of live) if (supports(item, currentKind) && !groups.has(groupKey(item))) groups.set(groupKey(item), item);
    return [...groups.entries()].sort((a, b) => naturalCompare(a[1].run.series, b[1].run.series) || naturalCompare(a[1].run.run ?? '', b[1].run.run ?? ''));
  }, [live, currentKind]);
  const selectedKey = selected && supports(selected, currentKind) ? groupKey(selected) : '';
  const currentKey = options.some(([key]) => key === seriesKey) ? seriesKey : options.some(([key]) => key === selectedKey) ? selectedKey : options[0]?.[0] ?? '';
  const candidates = useMemo(() => live.filter((item) => supports(item, currentKind) && groupKey(item) === currentKey)
    .sort((a, b) => {
      const pa = model.runPosition.get(a.run.id);
      const pb = model.runPosition.get(b.run.id);
      return ((pa?.row ?? Number.MAX_SAFE_INTEGER) - (pb?.row ?? Number.MAX_SAFE_INTEGER)) ||
        ((pa?.col ?? Number.MAX_SAFE_INTEGER) - (pb?.col ?? Number.MAX_SAFE_INTEGER)) || naturalCompare(a.run.id, b.run.id);
    }), [live, currentKind, currentKey, model.runPosition]);

  const previousSelection = useRef(selectedId);
  useEffect(() => {
    const changed = previousSelection.current !== selectedId;
    previousSelection.current = selectedId;
    // Selection from the Runs dock or keyboard follows into the sheet. A
    // direct type/series change instead selects the first available tile.
    if (changed && selected && live.some((item) => item.run.id === selectedId)) {
      if (!supports(selected, currentKind)) {
        setKind(selected.run.suffix === 'T1w' ? 'anat' : selected.run.suffix === 'dwi' ? 'b0' : 'mean');
        setSeriesKey(groupKey(selected));
        setRequestedZ(null);
        return;
      }
      if (selectedKey !== currentKey) {
        setSeriesKey(selectedKey);
        setRequestedZ(null);
        return;
      }
    }
    if (candidates.length && !candidates.some((item) => item.run.id === selectedId)) selectRun(candidates[0].run.id);
  }, [candidates, selectedId, selectRun, selected, live, currentKind, selectedKey, currentKey]);

  const sourceKey = `${datasetPath}|${currentKind}|${currentKey}|${requestedZ}|${candidates.map((item) => item.run.path).join('|')}`;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const anchor = useBidsResource(datasetPath && candidates.length ? sourceKey : null, async () => {
    let failure = 'No image is available for this series.';
    for (const item of candidates) {
      if (!mounted.current || sourceKeyRef.current !== sourceKey || useBidsStore.getState().datasetPath !== datasetPath) {
        throw new Error('The image view changed.');
      }
      if (isImageUnavailable(item.run)) continue;
      try {
        const image = await fetchSlice({
          path: item.run.path, kind: currentKind, world_z_mm: requestedZ, max_px: 160,
          ...(currentKind === 'b0' && datasetPath ? { dataset_root: datasetPath } : {}),
        });
        return { image, item };
      } catch (error) { failure = formatTauriError(error); }
    }
    throw new Error(failure);
  });

  useEffect(() => {
    if (anchor.status !== 'ready' || !datasetPath) { setReference(null); return; }
    const { image, item } = anchor.data;
    setReference({ datasetPath, series: item.run.series, run: item.run.run, kind: currentKind,
      worldZ: image.world_z_mm, window: [image.window_low, image.window_high] });
    return () => setReference(null);
  }, [anchor.status, anchor.data, datasetPath, currentKind, setReference]);

  const reference = useBidsStore((state) => state.imageReference);
  const readyReference = anchor.status === 'ready' && reference && reference.datasetPath === datasetPath &&
    reference.kind === currentKind && groupOf(reference.series, reference.run) === currentKey &&
    reference.worldZ === anchor.data.image.world_z_mm && reference.window[0] === anchor.data.image.window_low &&
    reference.window[1] === anchor.data.image.window_high ? reference : null;
  const sorted = useMemo(() => {
    if (sort === 'matrix') return candidates;
    const value = (item: BidsRunFacts) => sort === 'tsnr' ? item.tsnr : item.meanFd;
    return [...candidates].sort((a, b) => {
      const x = value(a); const y = value(b);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return sort === 'tsnr' ? x - y : y - x;
    });
  }, [candidates, sort]);

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col bg-bf-bg-panel" data-testid="bids-images">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bf-border-subtle px-3 py-1.5">
        <SegmentedControl aria-label="Image type" value={currentKind} options={KINDS.map((item) => ({ ...item, disabled: !available.some((a) => a.value === item.value) }))}
          onValueChange={(value) => { setKind(value as ImageKind); setSeriesKey(''); setRequestedZ(null); }} />
        <Select aria-label="Series" className="max-w-48" value={currentKey} onChange={(event) => { setSeriesKey(event.target.value); setRequestedZ(null); }}>
          {options.map(([key, item]) => <option key={key} value={key}>{seriesLabel(item.run.series)}{item.run.run ? ` run-${item.run.run}` : ''}</option>)}
        </Select>
        <SegmentedControl aria-label="Sort images" value={sort} onValueChange={(value) => setSort(value as Sort)}
          options={[{ value: 'matrix', label: 'Matrix order' }, { value: 'tsnr', label: 'tSNR' }, { value: 'fd', label: 'FD' }]} />
        {anchor.status === 'ready' && anchor.data.image.world_z_mm !== null ? (
          <label className="flex items-center gap-1 text-bf-xs text-bf-text-muted">
            Slice z
            <NumberField key={sourceKey} aria-label="Slice z in millimeters" fieldClassName="w-20" unit="mm"
              defaultValue={Number(anchor.data.image.world_z_mm.toFixed(1))}
              onBlur={(event) => { const value = event.currentTarget.value.trim(); const next = Number(value); if (value && Number.isFinite(next)) setRequestedZ(next); }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </label>
        ) : null}
      </div>
      <p className="m-0 shrink-0 px-3 py-1 text-bf-2xs text-bf-text-faint">
        {anchor.status === 'ready' ? `${formatZ(anchor.data.image.world_z_mm)} · shared window ${anchor.data.image.window_low.toPrecision(3)}–${anchor.data.image.window_high.toPrecision(3)} from ${runLabel(anchor.data.item.run)} · nearest slice; no registration implied.` : 'A reference image sets the shared slice and window.'}
        {currentKind === 'mean' ? ' Mean of up to 8 volumes.' : currentKind === 'b0' ? ' Mean of volumes with b=0.' : currentKind === 'tsnr' ? ' Map from the run; sorting uses recorded tSNR.' : ''}
      </p>
      <div className="relative min-h-0 flex-1">
      <div ref={scroller} className="absolute inset-0 overflow-auto px-3 pb-6" aria-label="Image contact sheet">
        {anchor.status === 'error' ? <p role="alert" className="text-bf-sm text-bf-text-muted">Reference image could not be read: {anchor.error}</p>
          : !candidates.length ? <p className="text-bf-sm text-bf-text-muted">No images match this view.</p>
            : !readyReference ? <p className="text-bf-sm text-bf-text-muted">Loading reference image…</p>
              : <div className="grid gap-x-1 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
                {sorted.map((facts) => <ImageTile key={facts.run.id} facts={facts} selected={facts.run.id === selectedId}
                  highlighted={!!model.lens.lens && model.lens.mode === 'highlight' && facts.inLens}
                  reference={readyReference} queue={queue} scroller={scroller} sort={sort} />)}
              </div>}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-bf-bg-panel to-transparent" />
      </div>
    </div>
  );
}
