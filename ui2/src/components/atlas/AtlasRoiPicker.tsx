import React, { useEffect, useId, useRef, useState } from 'react';
import type { AtlasRoiLocation } from '@brainflow/api';
import { atlasRoiService } from '@/services/AtlasRoiService';
import { useLayerStore } from '@/stores/layerStore';
import { parcelError } from './ParcelTableImport';

/** Search names and IDs; every selection lands at an actual voxel in the ROI. */
export function AtlasRoiPicker({
  layerId,
  selectedId,
  onSelect,
}: {
  layerId: string;
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  const volumeId = useLayerStore((s) => s.layers.find((l) => l.id === layerId)?.volumeId);
  const [rois, setRois] = useState<AtlasRoiLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const generation = useRef(0);
  const listId = useId();
  useEffect(() => {
    const request = ++generation.current;
    setRois([]);
    setLoading(true);
    setError('');
    if (!volumeId) {
      setLoading(false);
      return;
    }
    atlasRoiService
      .locations(volumeId)
      .then((result) => {
        if (generation.current === request) setRois(result);
      })
      .catch((e) => {
        if (generation.current === request) setError(parcelError(e));
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [volumeId]);
  const selected = rois.find((r) => r.id === selectedId);
  const normalized = query.trim().toLowerCase();
  const matches = rois.filter((r) =>
    `${r.id} ${r.name} ${r.hemisphere ?? ''} ${r.network ?? ''}`.toLowerCase().includes(normalized),
  );
  const index = rois.findIndex((r) => r.id === selectedId);
  const navigable = rois.filter((r) => r.worldMm);
  const previous = [...navigable].reverse().find((r) => r.id < selectedId);
  const next = navigable.find((r) => r.id > selectedId);
  const choose = async (roi: AtlasRoiLocation) => {
    setOpen(false);
    setError('');
    if (!roi.worldMm) {
      setError('This ROI has no voxels in the loaded atlas image');
      return;
    }
    onSelect(roi.id);
    const request = generation.current;
    try {
      await atlasRoiService.focus(layerId, roi);
    } catch (e) {
      if (generation.current === request) setError(parcelError(e));
    }
  };
  const buttonClass =
    'rounded border border-border px-2 py-1 text-[11px] hover:bg-accent/40 disabled:opacity-40';
  return (
    <div className="space-y-2 py-2 text-[12px]">
      <label htmlFor={`${listId}-input`} className="text-muted-foreground">
        ROI
      </label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-label="Search ROIs by name or ID"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${listId}-${matches[active].id}` : undefined
        }
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px]"
        placeholder={loading ? 'Loading ROI names…' : 'Search name or ID…'}
        disabled={loading}
        value={open ? query : selected ? `${selected.id} · ${selected.name}` : ''}
        onFocus={() => {
          setQuery('');
          setActive(Math.max(0, index));
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              Math.max(0, Math.min(matches.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
            );
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            void choose(matches[active]);
          }
        }}
      />
      {open && (
        <div
          role="listbox"
          id={listId}
          aria-label="Matching ROIs"
          className="max-h-52 overflow-y-auto rounded border border-border bg-background"
        >
          {matches.map((roi, i) => (
            <div
              key={roi.id}
              id={`${listId}-${roi.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={!roi.worldMm}
              ref={(node) => {
                if (i === active && node?.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
              }}
              className={`cursor-pointer px-2 py-1.5 ${i === active ? 'bg-accent' : 'hover:bg-accent/40'} ${roi.worldMm ? '' : 'opacity-40'}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(roi)}
            >
              <p className="break-words">
                <span className="font-mono text-muted-foreground">{roi.id}</span> · {roi.name}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {[roi.hemisphere, roi.network, !roi.worldMm ? 'absent in this image' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ))}
          {!matches.length && <p className="p-2 text-muted-foreground">No matching ROIs</p>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-muted-foreground">
          ID
          <input
            type="number"
            min={0}
            step={1}
            aria-label="Label ID"
            value={selectedId}
            disabled={loading}
            className="w-16 rounded border border-border bg-background px-1 py-1 font-mono text-foreground"
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!Number.isInteger(id) || id < 0) return;
              const roi = rois.find((r) => r.id === id);
              if (roi) void choose(roi);
              else {
                onSelect(id);
                setError(id === 0 ? '' : `ROI ${id} is not in this atlas`);
              }
            }}
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          aria-label="Previous ROI"
          disabled={!previous}
          onClick={() => previous && void choose(previous)}
        >
          ←
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Next ROI"
          disabled={!next}
          onClick={() => next && void choose(next)}
        >
          →
        </button>
      </div>
      {selected && (
        <p className="text-[11px] text-muted-foreground">
          {selected.hemisphere} · {selected.voxelCount.toLocaleString()} voxels
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
