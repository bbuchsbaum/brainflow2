import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  GroupMark,
  OUTLIER_MARK,
  groupMark,
  groupMarkParts,
  groupMarksFor,
  type GroupMarkKind,
} from '../groupMarks';

afterEach(cleanup);

it('up to three groups differ in fill alone: filled, open, ringed circles', () => {
  expect([0, 1, 2].map((i) => groupMark(i, 3))).toEqual(['circle', 'circle-open', 'circle-ringed']);
  expect([0, 1].map((i) => groupMark(i, 2))).toEqual(['circle', 'circle-open']);
  expect(groupMark(0, 1)).toBe('circle');
});

it('more than three groups take distinct shapes, all different until they cycle', () => {
  const marks = Array.from({ length: 8 }, (_, i) => groupMark(i, 8));
  expect(new Set(marks).size).toBe(8);
  expect(marks.slice(0, 4)).toEqual(['circle', 'square', 'triangle', 'diamond']);
  // Past the list they cycle; a bad index is the first mark.
  expect(groupMark(8, 9)).toBe(marks[0]);
  expect(groupMark(-1, 5)).toBe('circle');
  // No mark of many groups is the outliers' mark.
  expect(marks).not.toContain(OUTLIER_MARK);
});

it('marks a grouping’s classes by their order among groups; outliers wear their own', () => {
  const marks = groupMarksFor([
    { id: 'a' },
    { id: 'outliers', outliers: true },
    { id: 'b' },
  ]);
  expect([...marks]).toEqual([
    ['a', 'circle'],
    ['b', 'circle-open'],
    ['outliers', OUTLIER_MARK],
  ]);
});

it('draws each mark in neutral ink: filled or stroked parts, the ring with its dot', () => {
  const kinds: GroupMarkKind[] = [
    'circle',
    'circle-open',
    'circle-ringed',
    'square',
    'triangle',
    'diamond',
    'cross',
    'plus',
    'triangle-down',
    'diamond-hollow',
  ];
  for (const kind of kinds) expect(groupMarkParts(kind, 5, 5, 3).length).toBeGreaterThan(0);
  expect(groupMarkParts('circle-ringed', 5, 5, 3).map((p) => p.filled)).toEqual([false, true]);
  expect(groupMarkParts('circle-open', 5, 5, 3)[0].filled).toBe(false);
  const { container } = render(<GroupMark index={2} k={3} size={12} />);
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('data-glyph')).toBe('circle-ringed');
  expect(svg.getAttribute('width')).toBe('12');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  const paints = [...svg.querySelectorAll('path')].flatMap((p) => [
    p.getAttribute('fill'),
    p.getAttribute('stroke'),
  ]);
  // Achromatic tokens only: never amber, never a raw colour.
  for (const paint of paints) expect(paint === 'none' || paint === 'var(--bf-text-secondary)').toBe(true);
  cleanup();
  expect(
    render(<GroupMark outlier />).container.querySelector('svg')!.getAttribute('data-glyph'),
  ).toBe('diamond-hollow');
});
