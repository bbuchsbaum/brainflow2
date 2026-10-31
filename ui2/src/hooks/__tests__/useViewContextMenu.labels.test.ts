import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * QA 2026-10-30 F47: the view context menu mixed "Hide pointer readout" with
 * "Hide Orientation Labels". Every item is sentence case: only the first word
 * is capitalised (acronyms such as "ROI" aside).
 */
describe('view context menu labels', () => {
  const source = readFileSync(resolve(__dirname, '../useViewContextMenu.ts'), 'utf8');
  const labels = [...source.matchAll(/'((?:Hide|Show|Image|Export)[^']*)'/g)].map((m) => m[1]);

  it('are sentence case', () => {
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const label of labels) {
      const rest = label.split(/\s+/).slice(1);
      expect(rest.filter((w) => /^[A-Z][a-z]/.test(w)), label).toEqual([]);
    }
  });
});
