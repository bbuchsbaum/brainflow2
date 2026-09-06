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
    renderFrame.rows.forEach((row) => {
      const name = String(row[facet] ?? '(missing)');
      groups.set(name, [...(groups.get(name) ?? []), row]);
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
    const n = width >= 640 ? 2 : 1;
    return (
      <div
        data-testid="plot-facets"
        style={{
          width,
          height,
          overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: `repeat(${n}, minmax(0,1fr))`,
          gap: 8,
        }}
      >
        {[...groups].map(([name, rows]) => (
          <div key={name}>
            <div style={{ fontSize: 11, padding: 4 }}>
              {renderFrame.columns.find((column) => column.name === facet)?.label ?? facet}: {name}
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
              height={Math.max(180, height / Math.ceil(groups.size / n) - 24)}
              context={context}
            />
          </div>
        ))}
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
