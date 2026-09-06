/**
 * SampleProvider — resolves a {@link SampleRequest} (a locus over a dataset)
 * into a tidy {@link SampleFrame}. This is the single seam between "where we
 * sample" and "how we plot": every plot mode consumes a frame from here rather
 * than calling sampling commands directly.
 *
 * Step 1 implements three loci:
 *   - `point` / `sphere` -> a series frame `(t: temporal, value: quantitative)`
 *     for 4D stacks, or a single scalar frame for 3D volumes, via the
 *     generalized `sample_stack` backend command (radius 0 == single voxel).
 *   - `wholeVolume` -> a binned histogram frame
 *     `(binStart, binEnd, binCenter, count)` via the existing histogram path.
 *
 * `roi` is reserved for step 3 (atlas-region sampling + design-table join).
 */

import { getTransport } from '@/services/transport';
import { useLayerStore } from '@/stores/layerStore';

import { column, frameFromScalar, frameFromSeries } from '@/plotting';
import type { FrameColumn, FrameRow, Locus, SampleFrame, SampleRequest } from '@/plotting';

interface LayerStackShape {
  /** True when the stack axis is temporal with >= 2 timepoints. */
  readonly isTemporal: boolean;
  readonly numTimepoints: number;
  /** Repetition time in seconds, when known. */
  readonly tr: number | null;
}

function layerStackShape(layerId: string): LayerStackShape {
  const layer = useLayerStore.getState().getLayer(layerId) as
    | { timeSeriesInfo?: { num_timepoints?: number; tr?: number | null } }
    | undefined;
  const ts = layer?.timeSeriesInfo;
  const numTimepoints = ts?.num_timepoints ?? 0;
  return {
    isTemporal: numTimepoints >= 2,
    numTimepoints,
    tr: ts?.tr ?? null,
  };
}

export class SampleProvider {
  private static instance: SampleProvider | null = null;

  static getInstance(): SampleProvider {
    if (!SampleProvider.instance) {
      SampleProvider.instance = new SampleProvider();
    }
    return SampleProvider.instance;
  }

  /** Resolve a request to a frame. In-flight signal cancellation is currently
   * supported for set sampling; other loci only check an already-aborted signal. */
  async sample(request: SampleRequest, signal?: AbortSignal): Promise<SampleFrame> {
    signal?.throwIfAborted();
    switch (request.locus.kind) {
      case 'wholeVolume':
        return this.sampleWholeVolume(request);
      case 'point':
      case 'sphere':
        return this.sampleSpatial(request, request.locus);
      case 'regions':
      case 'roi':
        return this.sampleRegions(request, request.locus);
      case 'set':
        return this.sampleSet(request, request.locus, signal);
      default: {
        // Exhaustiveness guard — a new Locus variant must be handled above.
        const exhaustive: never = request.locus;
        throw new Error(`SampleProvider: unknown locus ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** Point / sphere sampling of a stack -> series (4D) or scalar (3D) frame. */
  private async sampleSpatial(
    request: SampleRequest,
    locus: Extract<Locus, { kind: 'point' | 'sphere' }>,
  ): Promise<SampleFrame> {
    const reduce = request.reduce ?? 'mean';
    const radiusMm = locus.kind === 'sphere' ? locus.radiusMm : 0;

    const values = await getTransport().invoke<number[]>('sample_stack', {
      layerId: request.datasetId,
      worldMm: [locus.worldMm[0], locus.worldMm[1], locus.worldMm[2]],
      radiusMm,
      reduce,
    });

    const shape = layerStackShape(request.datasetId);
    const meta = {
      datasetId: request.datasetId,
      locus: locus.kind,
      radiusMm,
      reduce,
    };

    // The backend's return length is authoritative for the frame's shape:
    // > 1 -> a stack/series (4D), exactly 1 -> a single scalar (3D). Layer
    // metadata is consulted only to label the temporal axis (seconds when TR
    // is known), never to decide the shape — so stale/missing metadata cannot
    // truncate a real timeseries or fabricate one.
    if (values.length > 1) {
      const tr = shape.tr && shape.tr > 0 ? shape.tr : null;
      return frameFromSeries(values, {
        xName: 't',
        xRole: 'temporal',
        xUnit: tr ? 's' : undefined,
        xValues: tr ? values.map((_, i) => i * tr) : undefined,
        meta: {
          ...meta,
          tr,
          suggested: { mark: 'line', encoding: { x: 't', y: 'value' } },
        },
      });
    }

    // Single-value stack (3D volume).
    return frameFromScalar(values[0] ?? Number.NaN, { meta });
  }

  /** Whole-volume sampling -> a binned histogram frame. */
  private async sampleWholeVolume(request: SampleRequest): Promise<SampleFrame> {
    // Lazy-load so the (hot) spatial path does not pull the histogram service
    // and its event-bus wiring; also keeps mode tests free of that dependency.
    const { histogramService } = await import('@/services/HistogramService');
    const histogram = await histogramService.computeHistogram({
      layerId: request.datasetId,
      binCount: request.binCount ?? 256,
      excludeZeros: true,
    });

    const columns: FrameColumn[] = [
      column('binStart', 'quantitative'),
      column('binEnd', 'quantitative'),
      column('binCenter', 'quantitative'),
      column('count', 'quantitative'),
    ];
    const rows: FrameRow[] = histogram.bins.map((b) => ({
      binStart: b.x0,
      binEnd: b.x1,
      binCenter: (b.x0 + b.x1) / 2,
      count: b.count,
    }));

    return {
      columns,
      rows,
      meta: {
        datasetId: request.datasetId,
        locus: 'wholeVolume',
        min: histogram.minValue,
        max: histogram.maxValue,
        mean: histogram.mean,
        std: histogram.std,
        totalCount: histogram.totalCount,
        binCount: histogram.binCount,
        // The default mark + the rich (interactive) histogram payload the
        // `hist` mark renderer consumes; the columns above are the plain
        // grammar view of the same data.
        suggested: { mark: 'hist', encoding: { x: 'binCenter', y: 'count' } },
        histogram,
      },
    };
  }

  /**
   * Atlas-region sampling. `regions` -> one row per parcellation label
   * (`region` nominal ⋈ `value` quantitative ⋈ `voxelCount`), the canonical
   * "region × stat" bar frame; `roi` -> the single requested region's stat as a
   * scalar frame. Region names come from the atlas layer's palette legend (the
   * backend returns label ids only).
   */
  private async sampleRegions(
    request: SampleRequest,
    locus: Extract<Locus, { kind: 'regions' | 'roi' }>,
  ): Promise<SampleFrame> {
    const reduce = request.reduce ?? 'mean';
    const stats = await getTransport().invoke<
      { labelId: number; value: number; voxelCount: number }[]
    >('compute_region_stats', {
      scalarLayerId: request.datasetId,
      atlasLayerId: locus.atlasLayerId,
      reduce,
    });

    // Map label id -> region name from the atlas layer's legend, if present.
    const legend = (
      useLayerStore.getState().getLayer(locus.atlasLayerId) as
        | { atlasPaletteLegend?: { label_id: number; roi: string }[] }
        | undefined
    )?.atlasPaletteLegend;
    const nameById = new Map<number, string>();
    for (const entry of legend ?? []) nameById.set(entry.label_id, entry.roi);
    const regionName = (labelId: number) => nameById.get(labelId) ?? `Region ${labelId}`;

    const meta = {
      datasetId: request.datasetId,
      atlasLayerId: locus.atlasLayerId,
      reduce,
    };

    if (locus.kind === 'roi') {
      const hit = stats.find((s) => s.labelId === locus.labelId);
      return frameFromScalar(hit?.value ?? Number.NaN, {
        name: 'value',
        meta: {
          ...meta,
          locus: 'roi',
          labelId: locus.labelId,
          region: regionName(locus.labelId),
        },
      });
    }

    const columns: FrameColumn[] = [
      column('region', 'nominal'),
      column('value', 'quantitative'),
      column('voxelCount', 'quantitative'),
    ];
    const rows: FrameRow[] = stats.map((s) => ({
      region: regionName(s.labelId),
      value: s.value,
      voxelCount: s.voxelCount,
    }));
    return {
      columns,
      rows,
      meta: {
        ...meta,
        locus: 'regions',
        suggested: { mark: 'bar', encoding: { x: 'region', y: 'value' } },
      },
    };
  }

  /**
   * Cohort sampling: one reduced scalar per member at a world locus, CPU-loaded
   * member-by-member by the backend (no GPU registry pollution). Returns the
   * base `(member nominal, value quantitative)` frame; the caller joins the
   * design table (covariates) onto it via `joinDesignTable`.
   */
  private async invokeSet<T>(
    command: 'sample_set_at_world' | 'sample_set_trace_at_world',
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!signal) return getTransport().invoke<T>(command, args);
    const ticket = { id: crypto.randomUUID(), expiresAtMs: Date.now() + 120_000 };
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        // Native admission remembers cancellation even if it arrives first.
        void Promise.resolve()
          .then(() => getTransport().invoke('cancel_population_sample', { ticket }))
          .catch((error) => {
            console.warn('[SampleProvider] Native population cancellation failed:', error);
          });
        reject(signal.reason ?? new DOMException('Population sampling canceled', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([getTransport().invoke<T>(command, { ...args, ticket }), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async sampleSet(
    request: SampleRequest,
    locus: Extract<Locus, { kind: 'set' }>,
    signal?: AbortSignal,
  ): Promise<SampleFrame> {
    const reduce = request.reduce ?? 'mean';
    const members = locus.members.map((m) => {
      const member: {
        memberId: string;
        sourcePath: string;
        stackIndex?: number;
        expectedSha256?: string;
        displayLabel?: string;
        designValues?: { column: string; value: string }[];
      } = {
        memberId: m.memberId,
        sourcePath: m.sourcePath,
      };
      if (m.displayLabel !== undefined) {
        member.displayLabel = m.displayLabel;
      }
      if (m.stackIndex !== undefined) member.stackIndex = m.stackIndex;
      if (m.expectedSha256 !== undefined) member.expectedSha256 = m.expectedSha256;
      if (m.designValues !== undefined && m.designValues.length > 0) {
        member.designValues = m.designValues.map((value) => ({
          column: value.column,
          value: value.value,
        }));
      }
      return member;
    });
    const memberById = new Map(members.map((member) => [member.memberId, member]));
    const worldMm: [number, number, number] = [
      locus.worldMm[0],
      locus.worldMm[1],
      locus.worldMm[2],
    ];

    // Cross-set *trace*: each member carries a dispersion band (lower/upper) for
    // CI/error ribbons. `value`/`lower`/`upper` are `number | null` (a failed or
    // out-of-bounds member is `f32::NAN`, which serde serializes as JSON null).
    if (request.band !== undefined) {
      const band = request.band;
      const traces = await this.invokeSet<
        {
          memberId: string;
          displayLabel?: string | null;
          designValues?: { column: string; value: string }[];
          value: number | null;
          lower: number | null;
          upper: number | null;
          count: number;
          sourceRevision?: { sha256: string; sourceBytes: number } | null;
          error?: string | null;
        }[]
      >(
        'sample_set_trace_at_world',
        {
          members,
          worldMm,
          radiusMm: locus.radiusMm,
          reduce,
          band,
        },
        signal,
      );

      const hasMemberLabels = traces.some(
        (trace) => trace.displayLabel !== undefined || (trace.designValues?.length ?? 0) > 0,
      );
      const designColumns = Array.from(
        new Set(traces.flatMap((trace) => (trace.designValues ?? []).map((value) => value.column))),
      );

      return {
        columns: [
          column('member', 'nominal'),
          ...(hasMemberLabels ? [column('memberLabel', 'nominal')] : []),
          ...designColumns.map((name) => column(name, 'nominal')),
          column('value', 'quantitative'),
          column('lower', 'quantitative'),
          column('upper', 'quantitative'),
          column('count', 'quantitative'),
        ],
        rows: traces.map((t) => {
          const row: Record<string, number | string | null> = {
            member: t.memberId,
            value: t.value,
            lower: t.lower,
            upper: t.upper,
            count: t.count,
          };
          if (hasMemberLabels) {
            row.memberLabel = t.displayLabel ?? t.memberId;
          }
          const designValueByColumn = new Map(
            (t.designValues ?? []).map((value) => [value.column, value.value]),
          );
          for (const name of designColumns) {
            row[name] = designValueByColumn.get(name) ?? null;
          }
          return row;
        }),
        meta: {
          datasetId: request.datasetId,
          locus: 'set',
          radiusMm: locus.radiusMm,
          reduce,
          band,
          sources: traces.map((trace) => ({
            memberId: trace.memberId,
            sourceRevision: trace.sourceRevision ?? null,
            stackIndex: memberById.get(trace.memberId)?.stackIndex ?? null,
            validCount: trace.count,
            error: trace.error ?? null,
          })),
          ...(designColumns.length > 0 ? { designColumns } : {}),
          // A line through member values with a shaded lower..upper band.
          suggested: {
            mark: 'line',
            encoding: { x: hasMemberLabels ? 'memberLabel' : 'member', y: 'value' },
            band: { lower: 'lower', upper: 'upper' },
          },
        },
      };
    }

    // Plain scalar-per-member path. The backend marks a failed/out-of-bounds
    // member as `f32::NAN`; serde_json serializes NaN as JSON `null`, so the wire
    // type is `number | null` (NOT `number`). Downstream `numericColumn` coerces
    // null -> NaN, which the box mark / joinDesignTable already drop, but the
    // type must be honest.
    const samples = await this.invokeSet<
      {
        memberId: string;
        value: number | null;
        count?: number;
        sourceRevision?: { sha256: string; sourceBytes: number } | null;
        error?: string | null;
      }[]
    >(
      'sample_set_at_world',
      {
        members,
        worldMm,
        radiusMm: locus.radiusMm,
        reduce,
      },
      signal,
    );

    return {
      columns: [column('member', 'nominal'), column('value', 'quantitative')],
      rows: samples.map((s) => ({ member: s.memberId, value: s.value })),
      meta: {
        datasetId: request.datasetId,
        locus: 'set',
        radiusMm: locus.radiusMm,
        reduce,
        sources: samples.map((sample) => ({
          memberId: sample.memberId,
          sourceRevision: sample.sourceRevision ?? null,
          stackIndex: memberById.get(sample.memberId)?.stackIndex ?? null,
          validCount: sample.count ?? null,
          error: sample.error ?? null,
        })),
      },
    };
  }
}

/** Process-wide singleton. */
export const sampleProvider = SampleProvider.getInstance();
