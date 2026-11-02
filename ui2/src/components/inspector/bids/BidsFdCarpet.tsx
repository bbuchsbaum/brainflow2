import React, { useMemo } from 'react';
import type { BidsRunDetail, BidsSliceImage } from '@brainflow/api';
import { useBidsResource } from '@/hooks/useBidsResource';
import { getTransport } from '@/services/transport';
import { fdTraceStats } from '@/stores/bidsInspect';
import { formatTr, type BidsFdGroup, type BidsRunFacts } from '@/stores/bidsModel';
import { SliceFrameText, SliceTile } from './BidsSliceImage';
import { isImageUnavailable } from './bidsSlices';

const TRACE_W = 330;
const TRACE_H = 44;
const TRACE_MAX_MM = 1.6;
/** Per-frame censoring line, not the exclusion criterion (scientific rule 3). */
export const CENSOR_LINE_MM = 0.5;
const CARPET_W = 330;
const CARPET_H = 64;

const y = (mm: number) => TRACE_H - (Math.min(mm, TRACE_MAX_MM) / TRACE_MAX_MM) * (TRACE_H - 4);

function tracePoints(trace: ReadonlyArray<number | null>): string[] {
  const span = Math.max(1, trace.length - 1);
  // A gap at `n/a` stays a gap: one polyline per stretch of values.
  const lines: string[] = [];
  let line: string[] = [];
  trace.forEach((value, i) => {
    if (value === null) {
      if (line.length) lines.push(line.join(' '));
      line = [];
    } else {
      line.push(`${((i / span) * TRACE_W).toFixed(1)},${y(value).toFixed(1)}`);
    }
  });
  if (line.length) lines.push(line.join(' '));
  return lines;
}

function caveat(detail: BidsRunDetail, facts: BidsRunFacts, modal: BidsFdGroup | undefined) {
  const parts = [detail.fd_filtered ? 'Filtered.' : 'Unfiltered.'];
  if (facts.fdCaveat && facts.tr !== null) {
    const group = `TR ${formatTr(facts.tr)} s group`;
    parts.push(
      modal?.tr
        ? `${group}: not directly comparable with the modal TR ${formatTr(modal.tr)} s group.`
        : `${group}: not directly comparable with the modal group.`,
    );
  }
  return parts.join(' ');
}

export function BidsFdCarpet({
  facts,
  detail,
  modalGroup,
  datasetPath,
}: {
  facts: BidsRunFacts;
  detail: BidsRunDetail;
  modalGroup: BidsFdGroup | undefined;
  datasetPath: string | null;
}) {
  const { run } = facts;
  const unavailable = isImageUnavailable(run);
  const carpet = useBidsResource(unavailable ? null : `${datasetPath}|carpet|${run.path}`, () =>
    getTransport().invoke<BidsSliceImage>('get_bids_carpet', {
      path: run.path,
      width: CARPET_W,
      height: CARPET_H,
    }),
  );
  const hasTrace = detail.fd_trace.some((value) => value !== null);
  const lines = useMemo(() => tracePoints(detail.fd_trace), [detail.fd_trace]);
  const stats = useMemo(() => fdTraceStats(detail.fd_trace, CENSOR_LINE_MM), [detail.fd_trace]);
  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-bf-xs bg-bf-bg-canvas p-1" data-testid="bids-fd-carpet">
        {hasTrace ? (
          <svg
            viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
            preserveAspectRatio="none"
            className="block h-11 w-full"
            role="img"
            aria-label="Framewise displacement per volume"
          >
            <line
              x1={0}
              x2={TRACE_W}
              y1={y(CENSOR_LINE_MM)}
              y2={y(CENSOR_LINE_MM)}
              stroke="var(--bf-text-faint)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            {lines.map((points, i) => (
              <polyline
                key={i}
                points={points}
                fill="none"
                stroke="var(--bf-plot-line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        ) : null}
        <div className="flex h-16 items-center justify-center overflow-hidden">
          {unavailable ? (
            <SliceFrameText>Carpet not available here: image annexed and not fetched.</SliceFrameText>
          ) : carpet.status === 'ready' ? (
            <SliceTile image={carpet.data} alt="Carpet plot" className="object-fill" />
          ) : carpet.status === 'error' ? (
            <SliceFrameText role="alert">Carpet could not be read: {carpet.error}</SliceFrameText>
          ) : (
            <SliceFrameText>Loading…</SliceFrameText>
          )}
        </div>
      </div>
      {hasTrace ? (
        <p className="m-0 font-mono text-bf-2xs text-bf-text-faint" data-testid="bids-fd-caption">
          FD ({detail.fd_definition ?? 'definition not stated'}) ·{' '}
          {detail.fd_source ?? 'source not stated'} · mean {stats.mean?.toFixed(2)} mm · {stats.over}{' '}
          of {stats.frames} frames above the {CENSOR_LINE_MM} mm censoring line.{' '}
          {caveat(detail, facts, modalGroup)}
        </p>
      ) : (
        <p className="m-0 text-bf-xs text-bf-text-muted">
          No confounds file for this run, so no per-volume FD.
          {facts.meanFd !== null && run.iqms
            ? ` Mean FD ${facts.meanFd.toFixed(2)} mm from ${run.iqms.source}.`
            : ''}
        </p>
      )}
    </div>
  );
}
