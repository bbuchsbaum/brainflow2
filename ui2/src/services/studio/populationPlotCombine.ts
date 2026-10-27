import type { FrameColumn, FrameRow, SampleFrame } from '@/plotting';
import type { PinnedPopulationPlot } from './PopulationPlotService';
import { defaultPopulationPlotRecipe, validatePlotRecipe } from './populationPlot';

/** Union sampled observations. Membership is retained as a relation, never a
 * many-to-many join that silently multiplies contributions. */
export function combinePopulationPlots(plots: readonly PinnedPopulationPlot[]): SampleFrame {
  if (plots.length < 2 || plots.length > 8 || plots.some((p) => p.origins))
    throw new Error('Choose two to eight original pinned plots to combine.');
  const columns = new Map<string, FrameColumn>();
  const rows = new Map<string, FrameRow>();
  const units = new Set(
    plots.map((p) => p.frame.columns.find((c) => c.name === 'value')?.unit ?? ''),
  );
  if (units.size !== 1 || units.has(''))
    throw new Error('Combined plots require the same explicitly declared value units.');
  for (const p of plots) {
    validatePlotRecipe(p.frame, defaultPopulationPlotRecipe);
    const locus = p.query.request.locus;
    if (locus.kind !== 'set') throw new Error('Only sampled population probes can be combined.');
    for (const c of p.frame.columns) {
      if (c.name.startsWith('__population'))
        throw new Error('Reserved population provenance column.');
      const existing = columns.get(c.name);
      if (existing && (existing.role !== c.role || existing.unit !== c.unit))
        throw new Error(`Column ${c.name} has incompatible roles or units across plots.`);
      columns.set(c.name, c);
    }
    for (const row of p.frame.rows) {
      const id = String(row.member);
      const source = p.frame.meta?.sources?.find((s) => s.memberId === id);
      if (!source?.sourceRevision?.sha256 || source.error)
        throw new Error(`Observation ${id} has no verified source identity.`);
      const probe = JSON.stringify([
        locus.worldMm,
        locus.radiusMm,
        p.query.request.reduce ?? 'mean',
        source.maskRevision?.sha256 ?? null,
      ]);
      const key = JSON.stringify([
        p.setId,
        p.sessionRevision,
        id,
        source.sourceRevision.sha256,
        source.stackIndex,
        probe,
      ]);
      const existing = rows.get(key);
      if (existing) {
        const previous = Object.fromEntries(
          Object.entries(existing).filter(
            ([key]) => !key.startsWith('__population') && key !== 'member',
          ),
        );
        const incoming = Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== 'member'),
        );
        if (
          JSON.stringify(Object.entries(previous).sort()) !==
          JSON.stringify(Object.entries(incoming).sort())
        )
          throw new Error(
            'Overlapping snapshots disagree on values or metadata; refresh before combining.',
          );
        const names = new Set<string>(JSON.parse(String(existing.__populationSets)));
        names.add(p.label);
        rows.set(key, { ...existing, __populationSets: JSON.stringify([...names]) });
      } else {
        rows.set(key, {
          ...row,
          member: key,
          __populationObservation: id,
          __populationOrigin: p.id,
          __populationProbe: `${locus.worldMm.map((v) => v.toFixed(1)).join(', ')} mm · ${locus.radiusMm} mm · ${p.query.request.reduce ?? 'mean'}`,
          __populationSets: JSON.stringify([p.label]),
        });
      }
    }
  }
  for (const name of [
    '__populationObservation',
    '__populationOrigin',
    '__populationProbe',
    '__populationSets',
  ])
    columns.set(name, {
      name,
      role: 'nominal',
      label: (
        {
          __populationObservation: 'Observation',
          __populationOrigin: 'Source plot',
          __populationProbe: 'Probe',
          __populationSets: 'Set memberships',
        } as Record<string, string>
      )[name],
    });
  return {
    columns: [...columns.values()],
    rows: [...rows.values()].map((row) =>
      Object.fromEntries([...columns.keys()].map((name) => [name, row[name] ?? null])),
    ),
    meta: {
      combined: true,
      overlapPolicy: 'unique observation/source/frame/probe; memberships retained as JSON arrays',
    },
  };
}
