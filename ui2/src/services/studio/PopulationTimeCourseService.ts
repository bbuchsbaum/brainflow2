import type { SampleFrame } from '@/plotting';
import { sampleProvider } from '@/services/SampleProvider';
import type { PinnedPopulationPlot } from './PopulationPlotService';
import { defaultPopulationPlotRecipe } from './populationPlot';
export interface PopulationTimeAxis {
  firstFrame: number;
  count: number;
  start: number;
  step: number;
  unit: string;
  alignment: 'declared-common-axis';
}
export interface PopulationTrace {
  axis: PopulationTimeAxis;
  samples: { sampleId: string; memberId: string; frame: number }[];
}
export function validateTimeAxis(axis: PopulationTimeAxis) {
  if (
    !axis ||
    axis.alignment !== 'declared-common-axis' ||
    !Number.isSafeInteger(axis.firstFrame) ||
    axis.firstFrame < 0 ||
    !Number.isSafeInteger(axis.count) ||
    axis.count < 2 ||
    axis.count > 512 ||
    !Number.isSafeInteger(axis.firstFrame + axis.count) ||
    !Number.isFinite(axis.start) ||
    !Number.isFinite(axis.step) ||
    axis.step <= 0 ||
    !Number.isFinite(axis.start + (axis.count - 1) * axis.step) ||
    typeof axis.unit !== 'string' ||
    !axis.unit.trim() ||
    axis.unit.length > 32
  )
    throw new Error(
      'Declare 2–512 consecutive frames and a finite increasing common time axis with units.',
    );
}
export function validateTraceDefinition(trace: PopulationTrace) {
  validateTimeAxis(trace.axis);
  const { samples, axis } = trace;
  if (
    !Array.isArray(samples) ||
    !samples.length ||
    samples.length > 8192 ||
    new Set(samples.map((s) => s?.sampleId)).size !== samples.length ||
    samples.some(
      (s) =>
        !s ||
        typeof s.memberId !== 'string' ||
        !s.memberId ||
        s.sampleId !== JSON.stringify([s.memberId, s.frame]) ||
        !Number.isSafeInteger(s.frame) ||
        s.frame < axis.firstFrame ||
        s.frame >= axis.firstFrame + axis.count,
    )
  )
    throw new Error('Invalid time-course observation/frame identities.');
  const counts = new Map<string, number>();
  for (const sample of samples) counts.set(sample.memberId, (counts.get(sample.memberId) ?? 0) + 1);
  if ([...counts.values()].some((n) => n !== axis.count))
    throw new Error(
      'Time-course receipts require every declared frame, including unavailable samples.',
    );
}
export function validatePopulationTrace(plot: PinnedPopulationPlot) {
  if (!plot.trace) return;
  validateTraceDefinition(plot.trace);
  const { samples, axis } = plot.trace;
  const rows = new Map(plot.frame.rows.map((r) => [r.member, r]));
  if (
    samples.length !== rows.size ||
    samples.length !== plot.frame.rows.length ||
    samples.some((s) => {
      const row = rows.get(s.sampleId);
      return (
        row?.__traceObservation !== s.memberId ||
        row.__traceFrame !== s.frame ||
        row.__traceTime !== axis.start + (s.frame - axis.firstFrame) * axis.step
      );
    })
  )
    throw new Error('Invalid time-course observation/frame identities.');
}
/** Samples actual source frames. No interpolation, inferred TR, or replacement
 * of the population's declared per-observation analysis frames. */
export async function samplePopulationTimeCourse(
  plot: PinnedPopulationPlot,
  axis: PopulationTimeAxis,
  signal: AbortSignal,
  sample = sampleProvider.sample.bind(sampleProvider),
) {
  validateTimeAxis(axis);
  const locus = plot.query.request.locus;
  if (plot.origins || plot.trace || locus.kind !== 'set')
    throw new Error('Create time courses from an original pinned population probe.');
  if (!locus.members.length || locus.members.length * axis.count > 8192)
    throw new Error(
      'Time courses are limited to 8,192 observation-by-frame samples. Narrow the set or frame range.',
    );
  if (plot.frame.columns.some((c) => c.name.startsWith('__trace')))
    throw new Error('Reserved time-course column names are already present.');
  const originals = new Map(plot.frame.rows.map((r) => [String(r.member), r]));
  const samples: PopulationTrace['samples'] = [];
  const members = locus.members.flatMap((member) => {
    const proof = plot.frame.meta?.sources?.find((s) => s.memberId === member.memberId);
    if (!proof?.sourceRevision?.sha256 || proof.error || !originals.has(member.memberId))
      throw new Error('Every time-course source requires a verified pinned snapshot.');
    return Array.from({ length: axis.count }, (_, i) => {
      const frame = axis.firstFrame + i,
        sampleId = JSON.stringify([member.memberId, frame]);
      samples.push({ sampleId, memberId: member.memberId, frame });
      return {
        ...member,
        memberId: sampleId,
        stackIndex: frame,
        expectedSha256: proof.sourceRevision!.sha256,
      };
    });
  });
  const maskHashes = new Set(plot.frame.meta?.sources?.map((s) => s.maskRevision?.sha256 ?? null));
  if (maskHashes.size !== 1 || (locus.mask && ![...maskHashes][0]))
    throw new Error('Time-course mask identity is incomplete.');
  const mask = locus.mask ? { ...locus.mask, expectedSha256: [...maskHashes][0]! } : undefined;
  const rows: SampleFrame['rows'][number][] = [],
    sources: NonNullable<NonNullable<SampleFrame['meta']>['sources']>[number][] = [];
  for (let offset = 0; offset < members.length; offset += 128) {
    signal.throwIfAborted();
    const chunk = members.slice(offset, offset + 128);
    const result = await sample(
      { ...plot.query.request, band: undefined, locus: { ...locus, mask, members: chunk } },
      signal,
    );
    signal.throwIfAborted();
    if (
      result.rows.length !== chunk.length ||
      result.meta?.sources?.length !== chunk.length ||
      new Set(result.rows.map((r) => r.member)).size !== chunk.length ||
      chunk.some((m) => {
        const source = result.meta?.sources?.find((s) => s.memberId === m.memberId);
        return (
          !result.rows.some((r) => r.member === m.memberId) ||
          source?.error ||
          source?.sourceRevision?.sha256 !== m.expectedSha256 ||
          source.stackIndex !== m.stackIndex ||
          (source.maskRevision?.sha256 ?? null) !== (mask?.expectedSha256 ?? null)
        );
      })
    )
      throw new Error(
        'Time-course frames or source revisions could not be verified. No partial trace was saved.',
      );
    for (let i = 0; i < chunk.length; i++) {
      const identity = samples[offset + i];
      const measured = result.rows.find((r) => r.member === identity.sampleId)!;
      rows.push({
        ...originals.get(identity.memberId)!,
        ...measured,
        __traceObservation: identity.memberId,
        __traceFrame: identity.frame,
        __traceTime: axis.start + (identity.frame - axis.firstFrame) * axis.step,
      });
    }
    sources.push(...result.meta!.sources!);
  }
  const frame: SampleFrame = {
    columns: [
      ...plot.frame.columns,
      { name: '__traceObservation', label: 'Observation', role: 'nominal' },
      { name: '__traceFrame', label: 'Image frame (zero-based)', role: 'quantitative' },
      { name: '__traceTime', label: 'Time', role: 'quantitative', unit: axis.unit },
    ],
    rows,
    meta: { ...plot.frame.meta, sources, timeAlignment: axis },
  };
  return {
    frame,
    trace: { axis: structuredClone(axis), samples },
    query: {
      ...plot.query,
      request: { ...plot.query.request, locus: { ...locus, mask, members } },
    },
    recipe: {
      ...defaultPopulationPlotRecipe,
      x: '__traceTime',
      axis: 'time' as const,
      axisUnit: axis.unit,
      detail: '__traceObservation',
      mark: 'line' as const,
    },
  };
}
