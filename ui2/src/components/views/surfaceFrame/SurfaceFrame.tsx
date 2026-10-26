/**
 * The surface pane's viewport frame (UI redesign phase 3, item 10): the same
 * grammar as a slice pane, drawn over the surface canvas.
 *
 * - Header band (top-left, canvas scrim): "Surface · left · inflated ·
 *   lh.sensorimotor.func.gii", with the vertex count as a mono disclosure
 *   that opens faces and the mesh path. Replaces the boxed info card.
 * - Camera presets (top-right): L M D V A P, the slice frame's corner slot.
 * - Colorbar (right edge): the visible data overlay's colormap, window,
 *   threshold and statistic caption, the slice panes' ViewportColorbar.
 *
 * The frame is pointer-transparent except for its controls, so the camera
 * keeps every drag.
 */
import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/ui/bf';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { ViewportColorbar } from '../viewportFrame/ViewportColorbar';
import { surfaceColorbarLayer } from './surfaceColorbar';
import { shortLayerLabel } from '../viewportFrame/frameFormat';

const CAMERA_PRESETS = [
  { value: 'lateral', label: 'L', title: 'Lateral' },
  { value: 'medial', label: 'M', title: 'Medial' },
  { value: 'dorsal', label: 'D', title: 'Dorsal' },
  { value: 'ventral', label: 'V', title: 'Ventral' },
  { value: 'anterior', label: 'A', title: 'Anterior' },
  { value: 'posterior', label: 'P', title: 'Posterior' },
] as const;

const SCRIM = 'bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)]';

export interface SurfaceFrameProps {
  surface: LoadedSurface;
  width: number;
  height: number;
  /** Space kept clear at the top (e.g. an inline status strip). */
  topInset?: number;
}

export function SurfaceFrame({ surface, width, height, topInset = 0 }: SurfaceFrameProps) {
  const viewpoint = useSurfaceStore((s) => s.viewpoint);
  const setViewpoint = useSurfaceStore((s) => s.setViewpoint);
  const [open, setOpen] = useState(false);
  const colorbar = useMemo(() => surfaceColorbarLayer(surface), [surface]);
  const overlayName = colorbar?.name ?? null;
  const parts = ['Surface', surface.metadata.hemisphere, surface.metadata.surfaceType].filter(
    Boolean,
  ) as string[];

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="surface-frame">
      {/* Header band */}
      <div
        className={`absolute left-1.5 z-10 flex max-w-[60%] select-none flex-col gap-0.5 rounded-bf-xs ${SCRIM} px-1 text-bf-xs text-bf-text-secondary`}
        style={{ top: topInset + 4 }}
        data-testid="surface-frame-header"
      >
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          <span className="shrink-0">{parts.join(' · ')}</span>
          {overlayName ? (
            <span className="min-w-0 truncate text-bf-text-muted" title={overlayName}>
              {shortLayerLabel(overlayName)}
            </span>
          ) : (
            <span className="min-w-0 truncate text-bf-text-muted" title={surface.name}>
              {shortLayerLabel(surface.name)}
            </span>
          )}
          <button
            type="button"
            className="pointer-events-auto shrink-0 rounded-bf-xs font-mono text-bf-2xs tabular-nums text-bf-text-muted hover:text-bf-text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
            aria-expanded={open}
            aria-label={`${surface.metadata.vertexCount.toLocaleString()} vertices: mesh details`}
            onClick={() => setOpen((v) => !v)}
            data-testid="surface-frame-counts"
          >
            {surface.metadata.vertexCount.toLocaleString()} v {open ? '▴' : '▾'}
          </button>
        </div>
        {open ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 pb-0.5 font-mono text-bf-2xs text-bf-text-muted">
            <dt className="font-sans">Mesh</dt>
            <dd className="truncate" title={surface.metadata.path}>
              {surface.name}
            </dd>
            <dt className="font-sans">Vertices</dt>
            <dd>{surface.metadata.vertexCount.toLocaleString()}</dd>
            <dt className="font-sans">Faces</dt>
            <dd>{surface.metadata.faceCount.toLocaleString()}</dd>
          </dl>
        ) : null}
      </div>

      {/* Camera presets: the slice frame's top-right corner slot. */}
      <div className="pointer-events-auto absolute right-1.5 z-10" style={{ top: topInset + 4 }}>
        <SegmentedControl
          aria-label="Camera"
          options={CAMERA_PRESETS}
          value={viewpoint}
          onValueChange={(v) => setViewpoint(v)}
          data-testid="surface-camera-presets"
        />
      </div>

      {/* Overlay colorbar: right edge, the slice panes' component. */}
      {colorbar ? (
        <ViewportColorbar
          layer={colorbar}
          width={width}
          height={height}
          topReserve={topInset + 32}
          // Top-right under the camera presets, off the mesh.
          corner="top"
        />
      ) : null}
    </div>
  );
}
