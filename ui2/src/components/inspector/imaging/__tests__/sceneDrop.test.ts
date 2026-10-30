import { describe, expect, it } from 'vitest';
import { dropTargetAtY, dropTargetInList } from '../sceneDrop';

const rows = [
  { id: 'a', top: 0, bottom: 24 },
  { id: 'b', top: 26, bottom: 50 },
  { id: 'c', top: 52, bottom: 76 },
];

describe('dropTargetAtY (quick drag, QA §5.2)', () => {
  it('finds the row under the released centre', () => {
    expect(dropTargetAtY(rows, 10)).toBe('a');
    expect(dropTargetAtY(rows, 60)).toBe('c');
  });

  it('snaps gaps and overshoot to the nearest row', () => {
    expect(dropTargetAtY(rows, 24.6)).toBe('a');
    expect(dropTargetAtY(rows, 25.4)).toBe('b');
    expect(dropTargetAtY(rows, -40)).toBe('a');
    expect(dropTargetAtY(rows, 400)).toBe('c');
    expect(dropTargetAtY([], 10)).toBeNull();
  });
});

describe('dropTargetInList (review W6)', () => {
  const list = { left: 0, right: 200, top: 0, bottom: 76 };

  it('resolves a release inside the list', () => {
    expect(dropTargetInList(rows, list, { x: 100, y: 60 })).toBe('c');
  });

  it('cancels a release outside the list instead of reordering', () => {
    expect(dropTargetInList(rows, list, { x: 100, y: 400 })).toBeNull();
    expect(dropTargetInList(rows, list, { x: 260, y: 30 })).toBeNull();
    expect(dropTargetInList(rows, list, { x: 100, y: -5 })).toBeNull();
  });
});
