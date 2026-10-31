/**
 * The segmentation design directions: three from round 0 and the round-1
 * hybrid (h) for the segmentation module. Each
 * renders all seven design states (`DESIGN_STATES`) from the same shared
 * scene data; only layout and chrome differ.
 */

import type { ComponentType } from 'react';
import type { DesignState, DirectionId } from '@/modules/segmentation/components/shared/types';
import { DirectionA } from './a/DirectionA';
import { DirectionB } from './b/DirectionB';
import { DirectionC } from './c/DirectionC';
import { DirectionH } from './h/DirectionH';

export interface DirectionDef {
  id: DirectionId;
  title: string;
  concept: string;
  component: ComponentType<{ state: DesignState }>;
}

export const DIRECTIONS: Record<DirectionId, DirectionDef> = {
  a: {
    id: 'a',
    title: 'Workstation',
    concept:
      'Dense and keyboard-first: tool rail with keys, Trace layout, constraint strip in the viewport header, label list in the Inspector.',
    component: DirectionA,
  },
  b: {
    id: 'b',
    title: 'Reading room',
    concept:
      'Image-maximal: chrome recedes to the edges, a floating tool palette at the cursor, labels as a collapsible overlay, contrasts as a film strip.',
    component: DirectionB,
  },
  c: {
    id: 'c',
    title: 'Protocol-guided',
    concept:
      'A protocol step panel leads the work (rule, reference, landmark slab); tools and labels are scoped to the current step.',
    component: DirectionC,
  },
  h: {
    id: 'h',
    title: 'Hybrid',
    concept:
      "Round 1: A's tiled shell and Inspector label list, C's protocol step card and landmark limits, B's start card, slice ruler and status chip; partition labels, yielding crosshair, honest native geometry.",
    component: DirectionH,
  },
};
