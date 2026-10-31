/** Shared types for the segmentation design directions (round 0). */

export type Plane = 'coronal' | 'axial' | 'sagittal';

/** A rendered slice: a grayscale PNG on the 1 mm reference grid (1 px = 1 voxel). */
export interface SliceImage {
  key: string;
  url: string;
  plane: Plane;
  /** Voxel index along the plane's normal. */
  index: number;
  /** Display name of the contrast ("T2w", "T1w", "T2w · unsharp"). */
  contrast: string;
  /** A view-only lens (a filter); never written to. */
  viewOnly: boolean;
  cols: number;
  rows: number;
}

/** [column, row, label id] in slice display pixels. */
export type LabelVoxel = readonly [number, number, number];

/** [column, row] in slice display pixels. */
export type Voxel = readonly [number, number];

/** A point in slice display coordinates (voxel (c, r) covers [c, c+1) × [r, r+1)). */
export type Point = readonly [number, number];

export type LabelStatus = 'complete' | 'in-progress' | 'not-started' | 'proposal';

export interface LabelDef {
  id: number;
  name: string;
  /** Long name, for tooltips and protocol text. */
  long: string;
  /** Data colour (label swatch); never used for chrome. */
  color: string;
}

export interface LabelState extends LabelDef {
  voxels: number;
  mm3: number;
  locked: boolean;
  visible: boolean;
  status: LabelStatus;
  /** Why the label is locked, when it is ("complete", "protocol step"). */
  lockReason?: string;
}

export type ToolId = 'navigate' | 'brush' | 'eraser' | 'contour' | 'fill' | 'interpolate' | 'grow';

export interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  /** Phase in the roadmap; tools beyond phase 2 render disabled. */
  phase: number;
}

/** The six design states every direction renders. */
export type DesignState =
  | 'empty'
  | 'tracing'
  | 'multi-contrast'
  | 'blocked'
  | 'proposal'
  | 'review'
  | 'zoom';

export const DESIGN_STATES: readonly DesignState[] = [
  'empty',
  'tracing',
  'multi-contrast',
  'blocked',
  'proposal',
  'review',
  'zoom',
];

export const DESIGN_STATE_TITLES: Record<DesignState, string> = {
  empty: 'Empty session',
  tracing: 'Tracing',
  'multi-contrast': 'Multi-contrast Trace layout',
  blocked: 'Blocked stroke',
  proposal: 'Fill-between-slices proposal',
  review: 'Review mode',
  zoom: 'Zoomed tracing',
};

export type DirectionId = 'a' | 'b' | 'c' | 'h';
