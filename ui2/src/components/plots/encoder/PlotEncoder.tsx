/**
 * PlotEncoder — renders a {@link SampleFrame} according to a
 * {@link ResolvedPlotSpec} by dispatching on `spec.mark` to a mark renderer.
 *
 * This is the single rendering seam for every plot: histogram, time-series and
 * (future) by-factor / covariate / ROI plots all flow through here. Adding a
 * plot type is adding a mark renderer to the registry + an inference rule —
 * never a new bespoke chart component wired into a mode.
 */

import { useMemo, type ReactNode } from 'react';

import { applyTransforms } from '@/plotting';
import type { ResolvedPlotSpec, SampleFrame } from '@/plotting';

import { MARK_RENDERERS } from './registry';
import type { EncoderContext } from './types';

export interface PlotEncoderProps {
  readonly frame: SampleFrame;
  readonly spec: ResolvedPlotSpec;
  readonly width: number;
  readonly height: number;
  readonly context?: EncoderContext;
}

function EncoderMessage({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="plot-encoder-message"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        fontSize: 12,
        color: 'var(--app-text-muted)',
      }}
    >
      {children}
    </div>
  );
}

/** A facet's encoder context: datum labels take the row's index in the whole frame. */
function facetContext(context: EncoderContext | undefined, globalIndex: readonly number[]): EncoderContext | undefined {
  const link = context?.datumLink;
  if (!link?.label) return context;
  const label = link.label;
  return { ...context, datumLink: { ...link, label: (i: number) => label(globalIndex[i] ?? i) } };
}

export function PlotEncoder({ frame, spec, width, height, context }: PlotEncoderProps) {
  const Mark = MARK_RENDERERS[spec.mark];
  // The hist mark owns its own loading/empty/error states (via HistogramChart),
  // so it renders even for an empty frame; cartesian marks need rows.
  const isHist = spec.mark === 'hist';

  // Apply frame transforms (e.g. normalize) before encoding. The hist mark
  // reads its rich payload from meta, so leave its frame untransformed.
  const renderFrame = useMemo(
    () => (isHist ? frame : applyTransforms(frame, spec.transforms)),
    [isHist, frame, spec.transforms],
  );

  if (spec.encoding.facet) {
    const facet = spec.encoding.facet;
    const groups = new Map<string, typeof renderFrame.rows>();
    // Each facet's rows by their index in the whole frame: datum labels are
    // looked up in the caller's frame, not the facet's (round 3 F2).
    const globalIndex = new Map<string, number[]>();
    renderFrame.rows.forEach((row, i) => {
      const name = String(row[facet] ?? '(missing)');
      groups.set(name, [...(groups.get(name) ?? []), row]);
      globalIndex.set(name, [...(globalIndex.get(name) ?? []), i]);
    });
    if (groups.size > 12)
      return (
        <EncoderMessage>
          More than 12 facets. Select a smaller population or another factor.
        </EncoderMessage>
      );
    const ys = renderFrame.rows
      .flatMap((row) => [
        row[spec.encoding.y ?? ''],
        ...(spec.band ? [row[spec.band.lower], row[spec.band.upper]] : []),
      ])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const xs = renderFrame.rows
      .map((row) => row[spec.encoding.x ?? ''])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const domain = (values: number[]) => {
      let min = Infinity,
        max = -Infinity;
      values.forEach((v) => {
        min = Math.min(min, v);
        max = Math.max(max, v);
      });
      return !values.length ? [0, 1] : min === max ? [min - 1, max + 1] : [min, max];
    };
    // A caller may fix the columns (segments: one row up to four, round 3 T3);
    // otherwise two columns on a wide plot.
    const fixed = typeof spec.params.facetColumns === 'number' && spec.params.facetColumns > 0;
    const n = fixed ? Number(spec.params.facetColumns) : width >= 640 ? 2 : 1;
    const HEADER = 20;
    const facetHeight = fixed
      ? Math.max(120, height - HEADER)
      : Math.max(180, height / Math.ceil(groups.size / n) - 24);
    const hidden = fixed ? Math.max(0, groups.size - n) : 0;
    const facetLabel =
      typeof spec.params.facetLabel === 'string'
        ? null
        : (renderFrame.columns.find((column) => column.name === facet)?.label ?? facet);
    return (
      <div style={{ position: 'relative', width, height }}>
        <div
          data-testid="plot-facets"
          style={{
            width,
            height,
            overflow: 'auto',
            display: 'grid',
            gridTemplateColumns: `repeat(${n}, minmax(0,1fr))`,
            columnGap: 8,
          }}
        >
          {[...groups].map(([name, rows]) => (
            <div key={name} role="group" aria-label={facetLabel ? `${facetLabel}: ${name}` : name}>
              <div
                role="heading"
                aria-level={3}
                className="truncate px-1 text-bf-xs font-medium text-bf-text-secondary"
                style={{ height: HEADER, lineHeight: `${HEADER}px` }}
              >
                {facetLabel ? `${facetLabel}: ${name}` : name}
              </div>
              <PlotEncoder
                frame={{ ...renderFrame, rows }}
                spec={{
                  ...spec,
                  encoding: { ...spec.encoding, facet: undefined },
                  transforms: [],
                  params: {
                    ...spec.params,
                    yDomain: domain(ys),
                    xCategories: [
                      ...new Set(
                        renderFrame.rows.map((row) => String(row[spec.encoding.x ?? ''] ?? '')),
                      ),
                    ],
                    ...(xs.length ? { xDomain: domain(xs) } : {}),
                  },
                }}
                width={(width - 8 * (n - 1)) / n}
                height={facetHeight}
                context={facetContext(context, globalIndex.get(name) ?? [])}
              />
            </div>
          ))}
        </div>
        {hidden > 0 ? (
          <div
            data-testid="plot-facets-more"
            className="pointer-events-none absolute bottom-1 right-2 text-bf-2xs text-bf-text-muted"
          >
            {hidden} more below · scroll
          </div>
        ) : null}
      </div>
    );
  }

  let body: ReactNode;
  if (!Mark) {
    body = <EncoderMessage>Mark “{spec.mark}” is not available.</EncoderMessage>;
  } else if (!isHist && renderFrame.rows.length === 0) {
    body = <EncoderMessage>No data to plot.</EncoderMessage>;
  } else {
    body = <Mark frame={renderFrame} spec={spec} width={width} height={height} context={context} />;
  }

  return (
    <div
      data-testid="plot-encoder"
      data-mark={spec.mark}
      style={{ width, height, overflow: 'hidden' }}
    >
      {body}
    </div>
  );
}

export default PlotEncoder;
