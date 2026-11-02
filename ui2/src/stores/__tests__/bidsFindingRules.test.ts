import { describe, expect, it } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { deriveBidsModel, type BidsModel } from '../bidsModel';

const group = (model: BidsModel, id: string) => model.findings.groups.find((entry) => entry.id === id)!;

describe('finding rules keep distinct findings apart', () => {
  it('never merges two variants, nor titles that differ in a name with a digit', () => {
    const source = createBidsBrowserDataset().index('scan');
    const finding = source.findings[0];
    source.findings = [
      { ...finding, id: 'a', severity: 'info', tag: 'note', title: 'Missing echo-1 sidecar', run_ids: [] },
      { ...finding, id: 'b', severity: 'info', tag: 'note', title: 'Missing echo-2 sidecar', run_ids: [] },
      { ...finding, id: 'c', severity: 'info', tag: 'note', title: '3 files unread', run_ids: [] },
      { ...finding, id: 'd', severity: 'info', tag: 'note', title: '12 files unread', run_ids: [] },
    ] as never;
    const model = deriveBidsModel(source);
    const notes = group(model, 'notes').rules.map((rule) => rule.items.length);
    expect(notes).toEqual([1, 1, 2]);
    const variants = group(model, 'variants');
    expect(variants.rules).toHaveLength(variants.items.length);
  });
});
