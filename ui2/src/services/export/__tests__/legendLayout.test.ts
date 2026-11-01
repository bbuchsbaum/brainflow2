import { describe, expect, it } from 'vitest';
import {
  LEGEND_GROW_ROWS,
  legendBlockHeight,
  legendLines,
  legendRows,
  sideColumnMinHeight,
  sideColumnSplit,
} from '../compositeExport';
import type { ExportSideBar } from '../compositeExport';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';

const entries = (n: number): AtlasPaletteLegendEntry[] =>
  Array.from({ length: n }, (_, i) => ({ label_id: i + 1, roi: `R${i + 1}`, color: [i, i, i] }));

describe('Regions legend rows (QA 2026-10-30 F18)', () => {
  it('lists every entry that fits, with no fixed cap', () => {
    expect(legendRows(entries(10), 10)).toEqual({ rows: entries(10), more: 0 });
    expect(legendRows(entries(10), 12.7).rows).toHaveLength(10);
  });

  it('ends in "+N more" when the column runs out, never dropping silently', () => {
    const { rows, more } = legendRows(entries(10), 8);
    expect(rows).toHaveLength(7);
    expect(rows.length + more).toBe(10);
    expect(more).toBe(3);
  });

  it('a legend-only column is as tall as its rows, up to the growth limit', () => {
    const side = (n: number): ExportSideBar => ({ colorbar: null, value: null, legend: entries(n) });
    expect(sideColumnMinHeight(null, side(10), 1)).toBeCloseTo(legendBlockHeight(10, 1));
    expect(sideColumnMinHeight(null, side(400), 1)).toBeCloseTo(legendBlockHeight(LEGEND_GROW_ROWS, 1));
    expect(sideColumnMinHeight(null, { colorbar: null, value: null, legend: null }, 1)).toBe(0);
  });

  it('the legend under a colorbar gets the room it needs', () => {
    // A 400 px column: 60/40 split would give the legend 160 px.
    const legendH = legendBlockHeight(10, 1);
    expect(legendH).toBeGreaterThan(160);
    const split = sideColumnSplit(400, 150, legendH);
    expect(400 - split).toBeGreaterThanOrEqual(Math.floor(legendH));
    // Short legends leave the colorbar its 60%.
    expect(sideColumnSplit(400, 150, legendBlockHeight(2, 1))).toBe(240);
    // The colorbar block is never squeezed below its own minimum.
    expect(sideColumnSplit(400, 300, legendH)).toBe(300);
  });
});

describe('Regions legend grouped by label layer (F26 review)', () => {
  const aseg = { name: 'FreeSurfer ASEG', entries: entries(2) };
  const olsen = { name: 'Olsen MTL', entries: entries(2) };

  it('heads each layer’s regions with its name when several are drawn', () => {
    const lines = legendLines({ legend: [...aseg.entries, ...olsen.entries], legendGroups: [olsen, aseg] });
    expect(lines.map((l) => (l.kind === 'group' ? `# ${l.name}` : l.entry.roi))).toEqual([
      '# Olsen MTL',
      'R1',
      'R2',
      '# FreeSurfer ASEG',
      'R1',
      'R2',
    ]);
  });

  it('a single layer (or one with regions left) needs no subheader', () => {
    expect(legendLines({ legend: aseg.entries, legendGroups: [aseg] }).every((l) => l.kind === 'entry')).toBe(true);
    expect(
      legendLines({ legend: aseg.entries, legendGroups: [aseg, { name: 'Olsen MTL', entries: [] }] }).every(
        (l) => l.kind === 'entry',
      ),
    ).toBe(true);
  });

  it('the column grows for subheaders too', () => {
    const side: ExportSideBar = { colorbar: null, value: null, legend: [...aseg.entries, ...olsen.entries], legendGroups: [aseg, olsen] };
    expect(sideColumnMinHeight(null, side, 1)).toBeCloseTo(legendBlockHeight(6, 1));
  });

  it('"+N more" counts regions, not subheaders, and never ends on a subheader', () => {
    const lines = legendLines({ legend: [], legendGroups: [aseg, olsen] });
    const { rows, more } = legendRows(lines, 4, (l) => l.kind === 'entry');
    // Room for 3 rows + "+N more": "# ASEG, R1, R2" then the Olsen header would dangle.
    expect(rows.map((l) => l.kind)).toEqual(['group', 'entry', 'entry']);
    expect(more).toBe(2);
  });
});
