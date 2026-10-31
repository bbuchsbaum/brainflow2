/**
 * Per-state view props for the primary, orthogonal and contrast-strip
 * panels. Every direction renders the same pixels for a state; only the
 * layout and chrome around them differ.
 */

import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { BRUSH, CA1, DG } from './mockData';
import { CROSSHAIR, FOV, ORTHO, OVERLAYS, SCENE, slabRows } from './scenes';
import type { Overlay, SliceViewProps } from './SliceView';
import type { DesignState, SliceImage } from './types';

export type PanelProps = Omit<SliceViewProps, 'className' | 'overlay' | 'aria-label'>;

/** The primary tracing panel (coronal T2w) for a state. */
export function primaryView(state: DesignState): PanelProps {
  const image = DESIGN.images.corT2;
  const base = { image, crosshair: CROSSHAIR.coronal, center: SCENE.hippoCentre, fovMm: FOV.trace };
  switch (state) {
    case 'empty':
      return { image, crosshair: CROSSHAIR.coronal, center: [96.5, 100], fovMm: 180 };
    case 'tracing':
    case 'multi-contrast':
      return {
        ...base,
        overlays: OVERLAYS.labels(OVERLAYS.withStroke(SCENE.tracing.base, SCENE.tracing.wet)),
        brush: { center: SCENE.tracing.brush, radiusMm: BRUSH.radiusMm, label: CA1 },
      };
    case 'blocked':
      return {
        ...base,
        // Closer, so the refused footprint reads voxel by voxel.
        fovMm: 40,
        center: [SCENE.blocked.brush[0] + 4, SCENE.blocked.brush[1] + 1],
        overlays: [
          // DG, the label that refused the stroke, owns its edges and draws heavier.
          ...OVERLAYS.labels(SCENE.blocked.base, CA1, { emphasis: [DG, CA1] }),
          { kind: 'voxels', voxels: SCENE.blocked.footprint, color: 'var(--bf-warning)', hatch: true, opacity: 0.8 },
          { kind: 'voxels', voxels: SCENE.blocked.footprint, color: 'var(--bf-warning)', outline: true, dashed: true, width: 1.5 },
        ],
        brush: { center: SCENE.blocked.brush, radiusMm: BRUSH.radiusMm, tone: 'blocked' },
      };
    case 'proposal':
      return {
        ...base,
        overlays: [
          ...OVERLAYS.labels(SCENE.proposal.base, CA1),
          ...OVERLAYS.proposal(SCENE.proposal.voxels, CA1, SCENE.proposal.skipped),
        ],
        crosshair: CROSSHAIR.coronal,
      };
    case 'review':
      return {
        ...base,
        overlays: OVERLAYS.review(),
        center: SCENE.review.focus,
        fovMm: 44,
        // The crosshair stays out of the region under review.
        crosshairClear: { center: SCENE.review.focus, radiusMm: 7 },
      };
    case 'zoom':
      return {
        ...base,
        center: [SCENE.zoom.brush[0] + 2, SCENE.zoom.brush[1] - 1],
        fovMm: FOV.zoom,
        grid: true,
        overlays: OVERLAYS.labels(SCENE.zoom.base, CA1),
        brush: { center: SCENE.zoom.brush, radiusMm: BRUSH.radiusMm, label: CA1 },
      };
  }
}

/** Orthogonal panels; `slab` shades the protocol's body slab (direction C). */
export function orthoViews(state: DesignState, opts: { slab?: [number, number] } = {}): { axial: PanelProps; sagittal: PanelProps } {
  const empty = state === 'empty';
  const review = state === 'review';
  const labelsAx = review ? DESIGN.labels.axAll : DESIGN.labels.axTraced;
  const labelsSag = review ? DESIGN.labels.sagAll : DESIGN.labels.sagTraced;
  const rows = opts.slab ? slabRows(opts.slab[0], opts.slab[1]) : null;
  const slabAx: Overlay[] = rows ? [{ kind: 'slab', axis: 'y', from: rows.axial[0], to: rows.axial[1] }] : [];
  const slabSag: Overlay[] = rows ? [{ kind: 'slab', axis: 'x', from: rows.sagittal[0], to: rows.sagittal[1] }] : [];
  return {
    axial: {
      image: ORTHO.axial.image,
      crosshair: ORTHO.axial.crosshair,
      center: empty ? [96.5, 114.5] : ORTHO.axialCentre,
      fovMm: empty ? 200 : FOV.ortho,
      overlays: empty ? [] : [...slabAx, ...OVERLAYS.echo(labelsAx)],
    },
    sagittal: {
      image: ORTHO.sagittal.image,
      crosshair: ORTHO.sagittal.crosshair,
      center: empty ? [114.5, 100] : ORTHO.sagittalCentre,
      fovMm: empty ? 200 : FOV.ortho,
      overlays: empty ? [] : [...slabSag, ...OVERLAYS.echo(labelsSag)],
    },
  };
}

/** The linked contrast strip: same plane and position, other contrasts. */
export function stripViews(state: DesignState): Array<PanelProps & { image: SliceImage }> {
  const labels = state === 'proposal' ? SCENE.proposal.base : SCENE.tracing.base;
  const images = [DESIGN.images.corT2, DESIGN.images.corT1, DESIGN.images.corT2u];
  return images.map((image) => ({
    image,
    crosshair: CROSSHAIR.coronal,
    center: SCENE.hippoCentre,
    fovMm: FOV.strip,
    overlays:
      state === 'review'
        ? OVERLAYS.echo(SCENE.labelsA)
        : OVERLAYS.echo(
            state === 'tracing' || state === 'multi-contrast' ? OVERLAYS.withStroke(labels, SCENE.tracing.wet) : labels,
          ),
  }));
}

/** Zoom factor relative to fitting the whole slice. */
export function zoomFactor(fovMm: number): string {
  return `${(FOV.fit / fovMm).toFixed(1)}×`;
}
