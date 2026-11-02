import { describe, expect, it } from 'vitest';
import { abbreviateLabel, stackLabels } from '../coverageGeometry';

describe('coverage header labels', () => {
  const CHAR = 6;
  const COL = 30;

  it('never overlap, however long the task names', () => {
    const names = ['covertverbgeneration', 'fingerfootlips', 'linebisection', 'overtverbgeneration', 'overtwordrepetition', 'dwi'];
    const labels = names.map((name, i) => ({
      text: abbreviateLabel(name, COL * 3 - 4, CHAR),
      x: 100 + i * COL,
    }));
    const placed = stackLabels(labels, CHAR, 3);
    for (const a of placed) {
      for (const b of placed) {
        if (a === b || a.line !== b.line || a.x >= b.x) continue;
        expect(a.x + a.text.length * CHAR).toBeLessThanOrEqual(b.x);
      }
    }
  });

  it('keeps a label that fits, and marks one that does not', () => {
    expect(abbreviateLabel('rest', 86, CHAR)).toBe('rest');
    expect(abbreviateLabel('overtwordrepetition', 86, CHAR)).toBe('overtwo…tition');
    // Tasks that differ at the start or the end stay apart.
    expect(abbreviateLabel('overtverbgeneration', 86, CHAR)).not.toBe(abbreviateLabel('covertverbgeneration', 86, CHAR));
  });
});
