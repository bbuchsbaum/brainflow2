/** H's native-slice bars and ruler, driven by one live session snapshot. */
import React, { useEffect, useRef, useState } from 'react';
import { Pager } from '@/components/ui/bf';
import type { SegmentationSnapshot } from '@brainflow/api';
import { areaFlags } from './geometry';
import { mutedColor } from './colour';
export function SliceProgress({ snapshot, activeId, current, onPick }: { snapshot: SegmentationSnapshot; activeId: number; current: number; onPick(index: number): void }) {
  const [page, setPage] = useState(1);
  const max = snapshot.labels.reduce((max, label) => label.sliceVoxels.reduce((max, value) => Math.max(max, value), max), 1);
  const ordered = [...snapshot.labels].sort((a, b) => Number(b.definition.id === activeId) - Number(a.definition.id === activeId));
  const count = Math.max(1, Math.ceil(ordered.length / 8)), currentPage = Math.min(page, count);
  const rows = ordered.slice((currentPage - 1) * 8, currentPage * 8);
  return <div className="flex flex-col gap-1 py-2" data-testid="live-slice-matrix">
    <p className="flex items-baseline gap-2 text-bf-2xs text-bf-text-muted">Area by native slice<span className="ml-auto font-mono" data-testid="live-slice-matrix-scale">one scale · max {max} vx</span></p>
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-bf-2xs text-bf-text-muted" data-testid="live-slice-matrix-key">
      <span className="flex items-center gap-1"><span className="inline-block h-[7px] w-[5px] border border-bf-text-secondary" />in progress</span>
      <span className="flex items-center gap-1"><span className="inline-block h-[7px] w-[5px] border border-bf-text-secondary bg-bf-text-secondary" />complete</span>
      <span className="flex items-center gap-1"><span className="inline-block h-1 w-0.5 bg-bf-warning" />check: gap or area jump</span>
    </p>
    {rows.map((label) => {
      const flags = areaFlags(label.sliceVoxels, null, label.complete);
      const color = `rgb(${label.definition.color.join(' ')})`;
      const active = label.definition.id === activeId;
      return <div key={label.definition.id} className="flex h-[22px] items-center gap-2" data-matrix-row={label.definition.id}>
        <span className="w-[52px] shrink-0 truncate text-bf-2xs" title={label.definition.name}>{label.definition.abbreviation}</span>
        <span className="relative flex h-full min-w-0 flex-1 border-b border-bf-border-subtle">{label.sliceVoxels.map((value, index) => {
          const marks = flags.filter((flag) => flag.k === index + 1);
          return <button key={index} type="button" className="relative h-full min-w-0 flex-1 p-0 hover:bg-bf-bg-hover" aria-label={`${label.definition.name}, slice ${index + 1}: ${value} voxels${marks.length ? `, ${marks.map((flag) => flag.kind).join(', ')}` : ''}`} title={`Slice ${index + 1}: ${value} vx${marks.length ? ` · ${marks.map((flag) => flag.kind).join(', ')}` : ''}`} aria-current={index === current ? 'step' : undefined} onClick={() => onPick(index)}>
            {value > 0 ? <span className="absolute bottom-[4px] left-px right-px border" style={{ height: Math.max(1, value / max * 13), borderColor: active ? color : mutedColor(color, 'inactive'), background: label.complete ? color : 'transparent' }} data-bar={label.complete ? 'solid' : 'hollow'} /> : null}
            {index === current ? <span className="absolute inset-y-0 left-1/2 w-px bg-bf-text-muted" /> : null}
            {marks.length ? <span className="absolute left-1/2 top-0 h-1 w-0.5 bg-bf-warning" data-flag={marks.map((flag) => flag.kind).join(' ')} /> : null}
          </button>;
        })}</span>
      </div>;
    })}
    {count > 1 ? <Pager page={currentPage} count={count} onPageChange={setPage} label="Label area rows" noun="page" /> : null}
  </div>;
}
export function NativeSliceRuler({ snapshot, activeId, current, onPick }: { snapshot: SegmentationSnapshot; activeId: number; current: number; onPick(index: number): void }) {
  const label = snapshot.labels.find((row) => row.definition.id === activeId);
  const count = snapshot.dimensions[snapshot.normalAxis];
  // Keep the current slice in view as it changes (the ruler has more rows than fit).
  const currentRow = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { currentRow.current?.scrollIntoView?.({ block: 'nearest' }); }, [current]);
  return <nav aria-label="Native slice ruler" className="flex w-12 shrink-0 flex-col overflow-auto border-l border-bf-border-subtle bg-bf-bg-panel-sunken py-2" data-testid="live-slice-ruler">
    {Array.from({ length: count }, (_, index) => <button type="button" key={index} ref={index === current ? currentRow : undefined} aria-label={`Native slice ${index + 1}${label?.sliceVoxels[index] ? ', traced' : ', empty'}`} aria-current={index === current ? 'step' : undefined} className={`relative flex min-h-4 flex-1 items-center justify-between px-1 hover:bg-bf-bg-hover ${index === current ? 'bg-bf-bg-active' : ''}`} onClick={() => onPick(index)}>
      <span className="font-mono text-bf-2xs text-bf-text-muted">{index === current || index % 5 === 0 ? index + 1 : ''}</span>
      {label?.sliceVoxels[index] ? <span className={`h-[4px] w-3 border border-bf-text-secondary ${label.complete ? 'bg-bf-text-secondary' : ''}`} data-shape={label.complete ? 'bar' : 'hollow-bar'} /> : <span className="h-px w-1.5 bg-bf-text-faint" />}
    </button>)}
  </nav>;
}
