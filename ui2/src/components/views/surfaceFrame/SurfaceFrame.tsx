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
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SegmentedControl } from '@/components/ui/bf';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { ViewportColorbar } from '../viewportFrame/ViewportColorbar';
import { surfaceColorbarLayer } from './surfaceColorbar';
import { shortLayerLabel } from '../viewportFrame/frameFormat';

// Full words where they fit ("L" means left elsewhere in the app); in a
// narrow pane single letters, the full word in the tooltip and accessible
// name (v5 critics: the words covered the header at 1280).
const CAMERA_PRESETS = [
  { value: 'lateral', word: 'Lateral', letter: 'L', title: 'View from the lateral side' },
  { value: 'medial', word: 'Medial', letter: 'M', title: 'View from the medial side' },
  { value: 'dorsal', word: 'Dorsal', letter: 'D', title: 'View from above' },
  { value: 'ventral', word: 'Ventral', letter: 'V', title: 'View from below' },
  { value: 'anterior', word: 'Anterior', letter: 'A', title: 'View from the front' },
  { value: 'posterior', word: 'Posterior', letter: 'P', title: 'View from the back' },
] as const;

/** Below this pane width the presets show letters and the colorbar moves down. */
const SURFACE_FRAME_NARROW_PX = 560;
const FRAME_GAP_PX = 12;

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
  const reapplyViewpoint = useSurfaceStore((s) => s.reapplyViewpoint);
  const [open, setOpen] = useState(false);
  const narrow = width < SURFACE_FRAME_NARROW_PX;
  // The initial view needs the hemisphere (lateral is -x for left, +x for
  // right): without it no preset is shown as applied; a press still sets one.
  const hemisphere = String(surface.metadata.hemisphere ?? surface.geometry.hemisphere ?? '').toLowerCase();
  const knownHemisphere = ['left', 'right', 'lh', 'rh', 'l', 'r'].includes(hemisphere);
  const presetOptions = useMemo(
    () =>
      CAMERA_PRESETS.map((p) =>
        narrow
          ? { value: p.value, label: p.letter, title: `${p.word}: ${p.title.toLowerCase()}`, 'aria-label': p.word }
          : { value: p.value, label: p.word, title: p.title },
      ),
    [narrow],
  );
  // One width budget for the header row: the header gets what the presets
  // leave (measured), so the two never overlap.
  const presetsRef = useRef<HTMLDivElement>(null);
  const [presetsWidth, setPresetsWidth] = useState(0);
  useLayoutEffect(() => {
    const el = presetsRef.current;
    if (!el) return;
    const measure = () => setPresetsWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [narrow]);
  const headerMaxWidth = Math.max(80, width - presetsWidth - FRAME_GAP_PX - 12);
  const bottomBand = Math.max(120, Math.round(height * 0.3));
  const colorbar = useMemo(() => surfaceColorbarLayer(surface), [surface]);
  const overlayName = colorbar?.name ?? null;
  const parts = ['Surface', surface.metadata.hemisphere, surface.metadata.surfaceType].filter(
    Boolean,
  ) as string[];

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="surface-frame">
      {/* Header band */}
      <div
        className={`absolute left-1.5 z-10 flex select-none flex-col gap-0.5 rounded-bf-xs ${SCRIM} px-1 text-bf-xs text-bf-text-secondary`}
        style={{ top: topInset + 4, maxWidth: headerMaxWidth }}
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
      <div
        ref={presetsRef}
        className="pointer-events-auto absolute right-1.5 z-10"
        style={{ top: topInset + 4 }}
        data-testid="surface-camera-presets-slot"
      >
        <SegmentedControl
          aria-label="Camera"
          options={presetOptions}
          value={knownHemisphere ? viewpoint : ''}
          onValueChange={(v) => setViewpoint(v)}
          // Pressing the checked preset again (after an orbit) re-applies it.
          onReselect={() => reapplyViewpoint()}
          data-testid="surface-camera-presets"
        />
      </div>

      {/* Overlay colorbar: right edge, the slice panes' component. */}
      {colorbar ? (
        narrow ? (
          // Narrow: the mesh fills the pane's width, so the bar lives in a
          // bottom band (below a lateral / medial view) at the right.
          // (The bottom-corner bar takes at most half its area's height,
          // so the area is twice the band: the bar stays in the band.)
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ height: 2 * bottomBand }}
            data-testid="surface-colorbar-band"
          >
            <ViewportColorbar layer={colorbar} width={width} height={2 * bottomBand} />
          </div>
        ) : (
          <ViewportColorbar
            layer={colorbar}
            width={width}
            height={height}
            topReserve={topInset + 32}
            // Top-right under the camera presets, off the mesh.
            corner="top"
          />
        )
      ) : null}
    </div>
  );
}
