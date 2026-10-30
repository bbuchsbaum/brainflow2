import { describe, expect, it } from 'vitest';
import { resolveWindowLevelLayer } from '../windowLevelTarget';

const t1 = { id: 't1', visible: true, type: 'anatomical' };
const z = { id: 'z', visible: true, type: 'anatomical' };
const atlas = { id: 'atlas', visible: true, type: 'label', source: 'atlas' };
const sel = (id: string | null) => ({ inspectorLayerId: id, selectedLayerId: null });

describe('resolveWindowLevelLayer (QA top issue #9)', () => {
  it('edits the selected layer, not the bottom one', () => {
    expect(resolveWindowLevelLayer([t1, z], sel('z'))?.id).toBe('z');
    expect(resolveWindowLevelLayer([t1, z], sel('t1'))?.id).toBe('t1');
  });

  it('falls back to the topmost visible windowed layer', () => {
    expect(resolveWindowLevelLayer([t1, z], sel(null))?.id).toBe('z');
    // A selected atlas has no window: the topmost scalar layer is edited.
    expect(resolveWindowLevelLayer([t1, z, atlas], sel('atlas'))?.id).toBe('z');
    // A hidden selection is not edited blind.
    expect(resolveWindowLevelLayer([t1, { ...z, visible: false }], sel('z'))?.id).toBe('t1');
  });

  it('returns null without a windowed visible layer', () => {
    expect(resolveWindowLevelLayer([atlas], sel(null))).toBeNull();
  });
});

describe('window/level and template masks (review W5)', () => {
  const brain = { id: 'brain', visible: true, type: 'mask', source: 'template' };
  const bin = { id: 'bin', visible: true, type: 'mask', source: 'file' };
  const meta: Record<string, { isBinaryLike?: boolean }> = { brain: { isBinaryLike: false }, bin: { isBinaryLike: true } };

  it('windows a non-binary template mask (brain, GM, WM, CSF)', () => {
    expect(resolveWindowLevelLayer([t1, brain], sel('brain'), (id) => meta[id])?.id).toBe('brain');
  });

  it('skips a binary mask', () => {
    expect(resolveWindowLevelLayer([t1, bin], sel('bin'), (id) => meta[id])?.id).toBe('t1');
  });
});
