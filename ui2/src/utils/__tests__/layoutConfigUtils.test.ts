import { describe, expect, it } from 'vitest';
import type { LayoutConfig } from 'golden-layout';
import { areLayoutConfigsEqual, cloneLayoutConfig } from '@/utils/layoutConfigUtils';

const TEST_LAYOUT: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'component',
        componentType: 'FileBrowser',
        title: 'Files',
        componentState: {},
      },
      {
        type: 'stack',
        content: [
          {
            type: 'component',
            componentType: 'AxialView',
            title: 'Axial',
            componentState: { viewId: 'axial' },
          },
        ],
      },
    ],
  },
} as LayoutConfig;

describe('layoutConfigUtils', () => {
  it('treats cloned equivalent layouts as equal', () => {
    const cloned = cloneLayoutConfig(TEST_LAYOUT);

    expect(areLayoutConfigsEqual(TEST_LAYOUT, cloned)).toBe(true);
  });

  it('detects nested layout changes without serializing the whole tree', () => {
    const next = cloneLayoutConfig(TEST_LAYOUT);
    next.root!.content![1].content![0].title = 'Changed';

    expect(areLayoutConfigsEqual(TEST_LAYOUT, next)).toBe(false);
  });

  it('returns an isolated clone', () => {
    const cloned = cloneLayoutConfig(TEST_LAYOUT);
    cloned.root!.content![1].content![0].title = 'Mutated';

    expect(TEST_LAYOUT.root!.content![1].content![0].title).toBe('Axial');
  });
});
