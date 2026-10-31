/**
 * Direction H's view data, shared by the round 0-4 design states
 * (`DirectionH.tsx`) and the round-5 workflow states (`workflow/`): native
 * slice constants, the primary and orthogonal panel props, and the overlay
 * helpers (strokes while drawing, the neighbour line, islands). Plain data
 * and functions only, so the component files stay refresh-safe.
 */

import { bboxOf, brushReadout, labelIslands, neighbourDeparturePath, voxelsOf, worldToDisplay } from '@/modules/segmentation/components/shared/geometry';
import { BRUSH, CA1, NATIVE, NATIVE_SLICES_J, PROTOCOL, yOfJ } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, SCENE } from '@/modules/segmentation/components/shared/scenes';
import type { Box, Overlay } from '@/modules/segmentation/components/shared/SliceView';
import { orthoViews, primaryView, type PanelProps } from '@/modules/segmentation/components/shared/views';
import type { DesignState, LabelVoxel, Point, Voxel } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';

export const PRIMARY_J = DESIGN.primaryJ;
export const SLICE_INDEX = NATIVE_SLICES_J.indexOf(PRIMARY_J);
export const N_SLICES = NATIVE_SLICES_J.length;
/** Native slice number (1-based) of a template slice. */
export const kOf = (j: number) => NATIVE_SLICES_J.indexOf(j) + 1;
export const SLICE_K = SLICE_INDEX + 1;
/** Template slice index of a world y (mm). */
export const jOfY = (y: number) => y - DESIGN.grid.origin[1];
export const SLAB = PROTOCOL.slab;
export const DIAMETER = BRUSH.radiusMm * 2;
/** What the brush writes on the (simulated) native grid, and what the 1 mm mock imagery can draw. */
export const READOUT = brushReadout(DIAMETER, NATIVE.spacing, BRUSH.shape);
export const DRAWN = brushReadout(DIAMETER, [1, 1, 1], BRUSH.shape);
export const GRID = { voxelMm3: NATIVE.voxelMm3 };
/** The neighbour shown by default: the slice the tracer came from (k 10); the other is on a held key. */
export const PREV_J = PRIMARY_J - NATIVE.stepJ;
export const NEXT_J = PRIMARY_J + NATIVE.stepJ;

export const isPaint = (s: DesignState) => s === 'tracing' || s === 'multi-contrast' || s === 'blocked' || s === 'zoom';

/** The structure's extent on the primary: the crosshair keeps out of it while editing or reviewing. */
export const STRUCTURE_BOX: Box = bboxOf(
  [...SCENE.labelsA, ...SCENE.labelsB].map(([c, r]) => [c, r] as Voxel),
  2,
);

/** Opacity of the neighbour line: fainter than any label stroke. */
export const NEIGHBOUR_OPACITY = 0.35;

/**
 * Labels while drawing: no constant fill; each label stroked on its own inner
 * edge (active 1.5 px, others 1 px at 55%, complete and locked quieter); the
 * active label's faint fill inset by one voxel unless "Outline only" is on.
 */
export function strokeLabels(overlays: readonly Overlay[] | undefined, outlineOnly = false): Overlay[] {
  return (overlays ?? []).map((o) =>
    o.kind === 'labels' ? { ...o, fill: false, fillActive: outlineOnly ? undefined : [CA1] } : o,
  );
}

/**
 * The neighbour slice (the one you came from): a faint neutral line, never
 * the label's hue, never dashed, and only where it departs from this slice
 * by more than one voxel.
 */
export function neighbourOverlay(current: readonly LabelVoxel[]): Overlay {
  const prev = voxelsOf(DESIGN.labels.cor(PREV_J), CA1);
  const d = neighbourDeparturePath(prev, voxelsOf(current, CA1), 1);
  return { kind: 'path', d, className: 'stroke-bf-text-primary', width: 1, opacity: NEIGHBOUR_OPACITY, testId: 'neighbour-line' };
}

export function labelVoxelsOf(overlays: readonly Overlay[] | undefined): readonly LabelVoxel[] {
  const o = (overlays ?? []).find((x) => x.kind === 'labels');
  return o && o.kind === 'labels' ? o.voxels : [];
}

/** Islands of the active label (a ring each): quality control while tracing. */
export function islandOverlay(current: readonly LabelVoxel[]): Overlay {
  return { kind: 'islands', voxels: current, label: CA1 };
}

/** Islands of CA1 on the primary while tracing (the legend shows "island" only when there is one). */
export const ISLANDS_HERE = labelIslands(labelVoxelsOf(primaryView('tracing').overlays), CA1).length;

export function hPrimary(state: DesignState): PanelProps {
  const p = primaryView(state);
  const clear = { crosshairClearBox: STRUCTURE_BOX, crosshairClear: null };
  const here = labelVoxelsOf(p.overlays);
  switch (state) {
    case 'tracing':
    case 'multi-contrast':
      return { ...p, ...clear, fovMm: 48, overlays: [neighbourOverlay(here), ...strokeLabels(p.overlays), islandOverlay(here)] };
    case 'zoom':
      // The grid dims while the neighbour line shares the voxel edges.
      return { ...p, ...clear, gridOpacity: 0.07, overlays: [neighbourOverlay(here), ...strokeLabels(p.overlays), islandOverlay(here)] };
    case 'blocked':
      return { ...p, ...clear, overlays: [...strokeLabels(p.overlays), islandOverlay(here)] };
    case 'proposal':
      // Existing CA1 with its faint inset fill, added voxels hatched; strokes as while drawing.
      return { ...p, ...clear, fovMm: 48, overlays: [...strokeLabels(p.overlays), islandOverlay(here)] };
    case 'review':
      return { ...p, ...clear };
    default:
      return p;
  }
}

// ------------------------------------------------------------ orthogonals

/** Direction of the native slice plane in a world-frame view (display units), from the simulated tilt. */
export function sliceDir(plane: 'axial' | 'sagittal'): Point {
  if (plane === 'axial') {
    const t = (NATIVE.tiltDeg.axial * Math.PI) / 180;
    return [Math.cos(t), -Math.sin(t)];
  }
  // Sagittal: the slice leans with its top anterior (left), perpendicular to the long axis.
  const t = (NATIVE.tiltDeg.sagittal * Math.PI) / 180;
  return [Math.sin(t), Math.cos(t)];
}

/** Half-length of the native-slice band (mm): only near the structure. */
export const BAND_HALF_MM = 9;
/** Margin around the structure when the orthogonal views fit it (mm; unused once `fraction` is set). */
export const ORTHO_FIT_MARGIN_MM = 10;
/** Share of the panel the hippocampus fills in the orthogonal views. */
export const ORTHO_FIT_FRACTION = 0.8;
/** Gutters outside the image: the native slices meet the bottom edge in the sagittal view, the right edge in the axial. */
export const GUTTER = { sagittal: { side: 'bottom' as const, size: 16 }, axial: { side: 'right' as const, size: 34 } };

/**
 * Orthogonal views fitted so the hippocampus fills 80% of the panel, with a
 * whole-slice locator in the corner, so through-plane continuity can be
 * checked without losing place. Only the active label is drawn (a light
 * fill and its outline), so its continuity across k reads at a glance. The
 * primary's native slice is a band (14%) near the structure plus short
 * tilted ticks where its plane meets the frame; native slices, the landmark
 * limits and the head / body / tail zones sit in a gutter outside the image.
 */
export function hOrtho(state: DesignState): { axial: PanelProps; sagittal: PanelProps } {
  const o = orthoViews(state);
  if (state === 'empty') return o;
  const [x0, y0, z0] = CROSSHAIR_WORLD;
  const extent = (v: readonly LabelVoxel[]) => bboxOf(v.map(([c, r]) => [c, r] as Voxel));
  const mk = (plane: 'axial' | 'sagittal', all: readonly LabelVoxel[]): PanelProps => {
    const at = (y: number) => worldToDisplay(plane, [x0, y, z0]);
    const dir = sliceDir(plane);
    const box = extent(all);
    const base = o[plane];
    const shown = (state === 'review' ? all : plane === 'axial' ? DESIGN.labels.axTraced : DESIGN.labels.sagTraced).filter((v) => v[2] === CA1);
    return {
      ...base,
      fit: { box, marginMm: ORTHO_FIT_MARGIN_MM, fraction: ORTHO_FIT_FRACTION },
      locator: true,
      crosshairClearBox: bboxOf(all.map(([c, r]) => [c, r] as Voxel), 2),
      gutter: {
        ...GUTTER[plane],
        slices: NATIVE_SLICES_J.map((j) => ({ through: at(yOfJ(j)), current: j === PRIMARY_J })),
        limits: [at(SLAB.toY), at(SLAB.fromY)],
        zones: ['head', 'body', 'tail'],
      },
      overlays: [
        // The primary's native slice (2.0 mm), tilted by the obliquity: a faint fill near the structure, no edge lines.
        { kind: 'band', through: at(y0), dir, widthMm: NATIVE.spacing[2], lengthMm: BAND_HALF_MM, ticks: true },
        // The active label only: a light fill (the constant label alpha) and its outline.
        { kind: 'labels', voxels: shown, fill: true, active: [CA1] },
      ],
    };
  };
  return {
    axial: mk('axial', DESIGN.labels.axAll),
    sagittal: mk('sagittal', DESIGN.labels.sagAll),
  };
}
