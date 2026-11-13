import React from 'react';
import { createPortal } from 'react-dom';
import type { DatasetMarker } from '@brainflow/api';
import { FOCUS_RING } from '@/components/ui/bf';
import {
  analysesLabel,
  countSpoken,
  countText,
  datasetTypeLabel,
  pathFromRoot,
  pipelineLabel,
  plural,
} from '@/components/datasetCard/datasetCardFormat';
import { cn } from '@/utils/cn';

/** The page glyph that marks a folder with a `dataset_description.json`. */
export function PageIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="2.5" y="1.5" width="9" height="11" rx="1" />
      <path d="M4.8 4.8h4.4M4.8 7h4.4M4.8 9.2h2.6" />
    </svg>
  );
}

export interface DatasetMarkerButtonProps {
  marker: DatasetMarker;
  /** The folder's name, for the button's accessible name. */
  name: string;
  selected: boolean;
  /** Id of the hover summary while it shows. */
  describedBy?: string;
  onOpen: (button: HTMLButtonElement) => void;
}

/**
 * The marker on a folder row: a count ("4 analyses", or "4" where the row is
 * narrow) for a folder whose children are analyses, else the page icon. The
 * probe looks at a bounded number of children, so a large folder reads
 * "24+ analyses" ("24+" when narrow) and its hover summary "at least 24
 * analyses": a floor, not a figure to set against the card's own count. A real button, but not a tab
 * stop: the tree is one tab stop, and Space on the row does the same.
 */
export function DatasetMarkerButton({
  marker,
  name,
  selected,
  describedBy,
  onOpen,
}: DatasetMarkerButtonProps) {
  const isCount = marker.analysisCount !== null;
  const label = isCount
    ? `Show the ${countSpoken(
        marker.analysisCount ?? 0,
        marker.analysisCountTruncated,
        'analysis',
        'analyses',
      )} in ${name}`
    : `Show dataset description for ${name}`;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-dataset-marker={isCount ? 'analyses' : 'description'}
      aria-label={label}
      aria-describedby={describedBy}
      // The row starts a drag and selects on pointer events; the marker does neither.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
      className={cn(
        'flex h-[22px] shrink-0 items-center justify-center rounded-sm border bg-transparent p-0 text-bf-text-secondary hover:text-bf-text-primary',
        FOCUS_RING,
        isCount ? 'px-1 font-mono text-bf-xs font-normal text-bf-text-muted' : 'w-[22px]',
        // The selected row's marker reads as the button it is.
        selected
          ? 'border-bf-border-strong bg-bf-bg-active text-bf-text-primary'
          : 'border-transparent hover:border-bf-border',
      )}
    >
      {isCount ? (
        // One inline box: the button is a flex container, and a space at the
        // edge of a flex item is dropped ("24+analyses").
        <span className="whitespace-nowrap">
          {countText(marker.analysisCount ?? 0, marker.analysisCountTruncated)}
          {/* Dropped in a narrow panel (FileTreeRow.css): the folder name keeps the row. */}
          <span className="dataset-marker-unit">
            {' '}
            {plural(marker.analysisCount ?? 0, 'analysis', 'analyses')}
          </span>
        </span>
      ) : (
        <PageIcon />
      )}
    </button>
  );
}

export interface MarkerSummaryProps {
  id: string;
  marker: DatasetMarker;
  name: string;
  rootPath: string;
  path: string;
  /** The hovered row, in viewport coordinates. */
  anchor: { top: number; bottom: number; left: number; right: number };
}

const SUMMARY_WIDTH = 316;
const SUMMARY_ROOM = 150;

/**
 * The hover summary of a marked row, built only from the marker already in
 * the store: a title, the path, and what the description declares about its
 * origin. Counts and spaces need the folder to be walked, so they live in the
 * card. Rendered in a portal: the tree's rows clip anything inside them.
 */
export function MarkerSummary({ id, marker, name, rootPath, path, anchor }: MarkerSummaryProps) {
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  const fitsBeside = anchor.right + 8 + SUMMARY_WIDTH <= viewportWidth - 8;
  const left = fitsBeside
    ? anchor.right + 8
    : Math.max(8, Math.min(anchor.left, viewportWidth - SUMMARY_WIDTH - 8));
  const top = fitsBeside
    ? Math.max(8, Math.min(anchor.top, viewportHeight - SUMMARY_ROOM))
    : anchor.bottom + 4 + SUMMARY_ROOM <= viewportHeight
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - SUMMARY_ROOM);
  const isCount = marker.analysisCount !== null;
  const generatedBy = pipelineLabel(marker.summary?.generatedBy);
  const typeLabel = datasetTypeLabel(marker.summary?.datasetType);
  const rows: Array<[string, string]> = [];
  if (generatedBy) rows.push(['Generated by', generatedBy]);
  if (typeLabel) rows.push(['Type', typeLabel]);
  if (isCount) rows.push(['Contains', analysesLabel(marker)]);
  return createPortal(
    <div
      id={id}
      role="tooltip"
      data-testid="dataset-marker-summary"
      style={{ left, top, width: Math.min(SUMMARY_WIDTH, viewportWidth - 16) }}
      className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-bf-md border border-bf-border-strong bg-bf-bg-panel-raised px-3.5 py-3 text-bf-text-primary shadow-bf-panel"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-bf-md font-semibold leading-5 [overflow-wrap:anywhere]">
          {marker.summary?.name?.trim() || name}
        </span>
        <span className="font-mono text-bf-xs leading-4 text-bf-text-muted [overflow-wrap:anywhere]">
          {pathFromRoot(rootPath, path)}
        </span>
      </div>
      {rows.length > 0 ? (
        <dl className="m-0 grid grid-cols-[84px_minmax(0,1fr)] gap-y-[3px] text-bf-sm leading-[18px]">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-bf-text-muted">{label}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      {marker.issue ? (
        <span className="text-bf-xs leading-4 text-bf-text-muted [overflow-wrap:anywhere]">
          {marker.issue}
        </span>
      ) : null}
      <div className="border-t border-bf-border-subtle pt-2 text-bf-xs leading-4 text-bf-text-secondary">
        {isCount
          ? 'Click the count or press Space for the list of analyses'
          : 'Click the page icon or press Space for the full description'}
      </div>
    </div>,
    document.body,
  );
}
