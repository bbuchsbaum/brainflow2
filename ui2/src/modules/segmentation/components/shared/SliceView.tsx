/**
 * One slice of the reference grid, drawn as SVG over the rendered PNG.
 *
 * Square pixels: one uniform scale (`min(width, height) / fovMm` px per mm)
 * for both axes; the image is upscaled nearest-neighbour so voxels stay
 * honest. Label fills are voxel squares, outlines run along voxel edges, and
 * the brush footprint is the exact voxel set the brush rule writes
 * (`geometry.discFootprint`). The crosshair is a solid green hairline with
 * a light dark halo; it opens a gap around the brush while drawing, can stop
 * at a clear box (the structure being edited) or show as edge ticks only;
 * the brush outline is neutral white with a dark halo.
 */

import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ACTIVE_FILL_ALPHA,
  crosshairGapRadius,
  discFootprint,
  enclosedGaps,
  innerBandPath,
  insetVoxels,
  LABEL_FILL_ALPHA,
  LABEL_STROKE,
  labelEmphasis,
  partitionEdges,
  reviewEncoding,
  voxelFillPath,
  voxelOutlinePath,
  PLANE_LETTERS,
} from './geometry';
import { labelColor } from './mockData';
import type { LabelVoxel, Point, SliceImage, Voxel } from './types';

/**
 * Labels as an exclusive partition (one label per voxel). Fills use the
 * constant `LABEL_FILL_ALPHA`. Every label strokes the inner edge of its own
 * voxels over a 1 px dark halo (`geometry.innerBandPath`), so on a shared
 * edge both labels show, each in its own colour on its own side. Emphasis
 * (`geometry.LABEL_STROKE`): the active label 1.5 px full colour, other
 * labels 1 px at 55%, complete or locked labels (`quiet`) quieter still.
 * Unlabelled voxels enclosed by labels get a neutral dot (visible gaps).
 */
export interface LabelOverlay {
  kind: 'labels';
  voxels: readonly LabelVoxel[];
  /** Fill every label at the constant alpha (default true); false is outline mode. */
  fill?: boolean;
  /** Draw strokes (default true). */
  outline?: boolean;
  /** Stroke width (screen px) when no label is active. */
  width?: number;
  /** Active labels: 1.5 px, full colour (alias: `emphasis`). */
  active?: readonly number[];
  /** @deprecated use `active`. */
  emphasis?: readonly number[];
  /** Complete or locked labels: drawn quieter than other inactive labels. */
  quiet?: readonly number[];
  /** Faint fill (`ACTIVE_FILL_ALPHA`) of these labels, inset by one voxel. */
  fillActive?: readonly number[];
  /** Mark unlabelled voxels enclosed by labels (default true, voxels of 6 px or more). */
  gaps?: boolean;
  /** Only these labels (hidden labels are not drawn). */
  only?: readonly number[];
  /** Overall opacity of the layer. */
  opacity?: number;
  /** Fill only these labels; the rest are outline-only (hue carried by line, not by a blend). */
  fillOnly?: readonly number[];
}

export interface VoxelOverlay {
  kind: 'voxels';
  voxels: readonly Voxel[];
  color: string;
  fill?: number;
  outline?: boolean;
  width?: number;
  dashed?: boolean;
  /** Screen-px dash pattern ("2 2"); overrides `dashed`. */
  dash?: string;
  /** No dark halo under the outline (faint context lines). */
  bare?: boolean;
  /** Diagonal hatch in `color` (proposals, refused strokes). */
  hatch?: boolean;
  /** Draw every voxel's own square edge (footprints). */
  cells?: boolean;
  opacity?: number;
}

/** A shaded band between two display coordinates: a landmark slab or the current slice's thickness. */
export interface SlabOverlay {
  kind: 'slab';
  axis: 'x' | 'y';
  from: number;
  to: number;
  /** `slice`: the primary slice's true thickness (solid hairline edges). */
  tone?: 'landmark' | 'slice';
}

/**
 * A landmark limit: a solid labelled line across the view, or (`ticks`)
 * only short ticks where the line meets the frame, labelled in the margin,
 * unboxed. `through` + `dir` draw it tilted (an oblique native plane).
 */
export interface LimitOverlay {
  kind: 'limit';
  axis: 'x' | 'y';
  at: number;
  label: string;
  through?: Point;
  /** Direction of the line, display units (default along the axis). */
  dir?: Point;
  ticks?: boolean;
}

/**
 * A tilted band: the primary's native slice seen in a world-frame view, as a
 * faint fill with no edge lines (`through` its centre, `dir` along it,
 * `widthMm` across it).
 */
export interface BandOverlay {
  kind: 'band';
  through: Point;
  dir: Point;
  widthMm: number;
  /** Half-length along `dir`, mm (default: across the whole frame). */
  lengthMm?: number;
}

/**
 * Two raters on one slice: A's outline (once, solid, label colour); B only
 * where it departs (neutral long dash); disagreeing voxels textured
 * achromatically: A only, B only, relabelled.
 */
export interface ReviewOverlay {
  kind: 'review';
  a: readonly LabelVoxel[];
  b: readonly LabelVoxel[];
  show?: 'a' | 'b' | 'both';
  /** Labels rater B did not trace: drawn outline-only, never textured as "A only". */
  bNone?: readonly number[];
}

/** A raw path in display units (the neighbour slice's departures). */
export interface PathOverlay {
  kind: 'path';
  d: string;
  /** Tailwind stroke class. */
  className: string;
  /** Screen px. */
  width?: number;
  opacity?: number;
  testId?: string;
}

/** A small neutral glyph in each voxel (locked voxels a proposal skipped). */
export interface MarksOverlay {
  kind: 'marks';
  voxels: readonly Voxel[];
}

export type Overlay = LabelOverlay | VoxelOverlay | SlabOverlay | LimitOverlay | BandOverlay | ReviewOverlay | MarksOverlay | PathOverlay;

export interface BrushCursor {
  center: Point;
  radiusMm: number;
  /** The label the brush writes: the footprint fills in its colour. */
  label?: number;
  /** Kept for compatibility: the footprint is always drawn. */
  footprint?: boolean;
  /** `blocked`: warning-coloured footprint (a refused stroke). */
  tone?: 'neutral' | 'blocked';
}

export interface Projector {
  /** Screen position (px, relative to the view) of a display point. */
  project(p: Point): { x: number; y: number };
  scale: number;
  width: number;
  height: number;
}

export interface SliceViewProps {
  image: SliceImage;
  /** Millimetres visible across the shorter side of the view. */
  fovMm: number;
  /** View centre, display coords. */
  center: Point;
  overlays?: readonly Overlay[];
  crosshair?: Point | null;
  /**
   * Minimum gap (screen px) the crosshair opens around the brush while a
   * paint tool is active; the gap is at least three brush radii
   * (`geometry.crosshairGapRadius`).
   */
  crosshairGap?: number;
  /** Keep the crosshair out of a region under review (display centre, mm radius). */
  crosshairClear?: { center: Point; radiusMm: number } | null;
  /**
   * Keep the crosshair out of a structure's extent (display rect): the lines
   * stop at the box, leaving margin segments outside it.
   */
  crosshairClearBox?: Box | null;
  /** Edge ticks only (small tiles): the crosshair never crosses the image. */
  crosshairTicks?: boolean;
  brush?: BrushCursor | null;
  /** Voxel grid lines (only drawn when a voxel is at least 6 px). */
  grid?: boolean;
  /** Grid line opacity (dimmed while a neighbour line shares the voxel edges). */
  gridOpacity?: number;
  /** Fit this display box (plus `marginMm` on every side) instead of `fovMm` / `center`. */
  fit?: { box: Box; marginMm: number } | null;
  /** A margin outside the image for native slice ticks and landmark zones. */
  gutter?: Gutter | null;
  letters?: boolean;
  /** Dim the image (empty states, protocol picker backdrops). */
  dim?: boolean;
  /** Zoom readout in the bottom-right corner ("3.0×"). */
  zoomLabel?: string;
  /** HTML drawn over the view, positioned with the projector. */
  overlay?: (p: Projector) => React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** A display-coordinate rectangle. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A strip outside the image (bottom or right): a scale of the native slices
 * where each crosses the structure (its `through` point, projected straight
 * onto the gutter), one short tick per slice (the current one longer), a
 * full tick at each landmark limit and the zone names between them, so no
 * label ever sits over anatomy or is clipped.
 */
export interface Gutter {
  side: 'bottom' | 'right';
  /** Screen px. */
  size: number;
  slices: ReadonlyArray<{ through: Point; current?: boolean }>;
  limits: readonly Point[];
  /** Zone names in increasing gutter coordinate (limits + 1). */
  zones: readonly string[];
}

const FALLBACK = { width: 480, height: 360 };

/** Fill alpha of the brush preview (the voxels it writes): light, so the image shows through. */
export const BRUSH_PREVIEW_ALPHA = 0.16;

/** Where a line through `p` along `d` enters and leaves a w x h frame (screen px). */
function clipLine(p: { x: number; y: number }, d: Point, w: number, h: number) {
  const ts: number[] = [];
  if (Math.abs(d[0]) > 1e-9) ts.push(-p.x / d[0], (w - p.x) / d[0]);
  if (Math.abs(d[1]) > 1e-9) ts.push(-p.y / d[1], (h - p.y) / d[1]);
  const inside = ts
    .map((t) => ({ t, x: p.x + d[0] * t, y: p.y + d[1] * t }))
    .filter((q) => q.x >= -0.5 && q.x <= w + 0.5 && q.y >= -0.5 && q.y <= h + 0.5)
    .sort((a, b) => a.t - b.t);
  return inside.length >= 2 ? [inside[0], inside[inside.length - 1]] : null;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (s && s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size ?? FALLBACK] as const;
}

export function SliceView({
  image,
  fovMm,
  center,
  overlays = [],
  crosshair,
  crosshairGap = 12,
  crosshairClear = null,
  crosshairClearBox = null,
  crosshairTicks = false,
  brush,
  grid = false,
  gridOpacity = 0.14,
  fit = null,
  gutter = null,
  letters = true,
  dim = false,
  zoomLabel,
  overlay,
  className,
  'aria-label': ariaLabel,
}: SliceViewProps) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  // The image area: the view less its gutter.
  const vw = width - (gutter?.side === 'right' ? gutter.size : 0);
  const vh = height - (gutter?.side === 'bottom' ? gutter.size : 0);
  const fitted = fit
    ? {
        s: Math.min(vw / (fit.box.x1 - fit.box.x0 + 2 * fit.marginMm), vh / (fit.box.y1 - fit.box.y0 + 2 * fit.marginMm)),
        c: [(fit.box.x0 + fit.box.x1) / 2, (fit.box.y0 + fit.box.y1) / 2] as Point,
      }
    : null;
  const s = fitted ? fitted.s : Math.min(vw, vh) / fovMm;
  const cc = fitted ? fitted.c : center;
  const tx = vw / 2 - cc[0] * s;
  const ty = vh / 2 - cc[1] * s;
  const px = (n: number) => n / s;
  const projector: Projector = {
    project: (p) => ({ x: tx + p[0] * s, y: ty + p[1] * s }),
    scale: s,
    width,
    height,
  };

  const footprint = useMemo(
    () => (brush ? discFootprint(brush.center, brush.radiusMm) : []),
    [brush],
  );

  // Visible voxel window for the grid.
  const x0 = Math.floor(-tx / s);
  const y0 = Math.floor(-ty / s);
  const x1 = Math.ceil((width - tx) / s);
  const y1 = Math.ceil((height - ty) / s);
  const gridPath = useMemo(() => {
    if (!grid || s < 6) return '';
    const parts: string[] = [];
    for (let x = Math.max(0, x0); x <= Math.min(image.cols, x1); x++) parts.push(`M${x} ${Math.max(0, y0)}V${Math.min(image.rows, y1)}`);
    for (let y = Math.max(0, y0); y <= Math.min(image.rows, y1); y++) parts.push(`M${Math.max(0, x0)} ${y}H${Math.min(image.cols, x1)}`);
    return parts.join('');
  }, [grid, s, x0, x1, y0, y1, image.cols, image.rows]);

  const hatchColors = new Map<string, string>();
  overlays.forEach((o) => {
    if (o.kind === 'voxels' && o.hatch && !hatchColors.has(o.color)) hatchColors.set(o.color, `${uid}-hatch-${hatchColors.size}`);
  });
  if (brush?.tone === 'blocked' && !hatchColors.has('var(--bf-warning)'))
    hatchColors.set('var(--bf-warning)', `${uid}-hatch-${hatchColors.size}`);
  const hasReview = overlays.some((o) => o.kind === 'review');

  const ch = crosshair ? projector.project(crosshair) : null;
  const brushScreen = brush ? projector.project(brush.center) : null;
  const brushR = brush ? brush.radiusMm * s : 0;
  const clear = crosshairClear ? { at: projector.project(crosshairClear.center), r: crosshairClear.radiusMm * s } : null;
  const gapAt = brushScreen ?? clear?.at ?? null;
  const gap = brush ? crosshairGapRadius(brushR, crosshairGap) : clear ? clear.r : 0;
  const limits = overlays.filter((o): o is LimitOverlay => o.kind === 'limit');
  const box = crosshairClearBox
    ? { ...projector.project([crosshairClearBox.x0, crosshairClearBox.y0]), r: projector.project([crosshairClearBox.x1, crosshairClearBox.y1]) }
    : null;
  const screenBox = box ? { x0: box.x, y0: box.y, x1: box.r.x, y1: box.r.y } : null;
  const limitGeom = limits.map((o) => {
    const through = o.through ?? (o.axis === 'y' ? ([0, o.at] as Point) : ([o.at, 0] as Point));
    const dir = o.dir ?? (o.axis === 'y' ? ([1, 0] as Point) : ([0, 1] as Point));
    const p = projector.project(through);
    return { o, ends: clipLine(p, dir, vw, vh), dir };
  });
  const [lL, lR, lT, lB] = PLANE_LETTERS[image.plane];

  return (
    <div
      ref={ref}
      className={clsx('relative h-full w-full overflow-hidden bg-bf-bg-canvas', className)}
      role="img"
      aria-label={ariaLabel ?? `${image.contrast} ${image.plane} slice`}
    >
      <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
        <defs>
          {[...hatchColors].map(([color, id]) => (
            <pattern
              key={id}
              id={id}
              patternUnits="userSpaceOnUse"
              width={px(5)}
              height={px(5)}
              patternTransform="rotate(45)"
            >
              <rect width={px(1.6)} height={px(5)} style={{ fill: color }} />
            </pattern>
          ))}
          {hasReview ? <ReviewPatterns uid={uid} px={px} /> : null}
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${s})`}>
          <image
            href={image.url}
            width={image.cols}
            height={image.rows}
            preserveAspectRatio="none"
            style={{ imageRendering: 'pixelated', opacity: dim ? 0.6 : 1 }}
          />
          {overlays.map((o, i) => {
            if (o.kind === 'slab') {
              const band =
                o.axis === 'y'
                  ? { x: 0, y: Math.min(o.from, o.to), width: image.cols, height: Math.abs(o.to - o.from) }
                  : { x: Math.min(o.from, o.to), y: 0, width: Math.abs(o.to - o.from), height: image.rows };
              const edge = (v: number) =>
                o.axis === 'y' ? `M0 ${v}H${image.cols}` : `M${v} 0V${image.rows}`;
              const slice = o.tone === 'slice';
              return (
                <g key={i}>
                  <rect {...band} className="fill-bf-text-primary" fillOpacity={slice ? 0.16 : 0.06} />
                  <path
                    d={edge(o.from) + edge(o.to)}
                    className="stroke-bf-text-primary"
                    strokeOpacity={slice ? 0.55 : 0.3}
                    strokeWidth={px(1)}
                    fill="none"
                  />
                </g>
              );
            }
            if (o.kind === 'limit') return null;
            if (o.kind === 'band') {
              const n = Math.hypot(o.dir[0], o.dir[1]) || 1;
              const [ux, uy] = [o.dir[0] / n, o.dir[1] / n];
              const [nx, ny] = [-uy, ux];
              const L = o.lengthMm ?? 400;
              const hw = o.widthMm / 2;
              const [cx, cy] = o.through;
              const pts = [
                [cx - ux * L + nx * hw, cy - uy * L + ny * hw],
                [cx + ux * L + nx * hw, cy + uy * L + ny * hw],
                [cx + ux * L - nx * hw, cy + uy * L - ny * hw],
                [cx - ux * L - nx * hw, cy - uy * L - ny * hw],
              ];
              return (
                <polygon
                  key={i}
                  points={pts.map((q) => q.join(',')).join(' ')}
                  className="fill-bf-text-primary"
                  fillOpacity={o.lengthMm ? 0.1 : 0.13}
                  data-band
                />
              );
            }
            if (o.kind === 'labels') return <LabelLayer key={i} o={o} px={px} voxelPx={s} />;
            if (o.kind === 'path') {
              return o.d ? (
                <path
                  key={i}
                  d={o.d}
                  fill="none"
                  className={o.className}
                  strokeWidth={px(o.width ?? 1)}
                  strokeOpacity={o.opacity ?? 1}
                  strokeLinecap="square"
                  data-testid={o.testId}
                />
              ) : null;
            }
            if (o.kind === 'review') return <ReviewLayer key={i} o={o} uid={uid} px={px} />;
            if (o.kind === 'marks') {
              const d = o.voxels.map(([c, r]) => `M${c + 0.3} ${r + 0.3}L${c + 0.7} ${r + 0.7}M${c + 0.7} ${r + 0.3}L${c + 0.3} ${r + 0.7}`).join('');
              return (
                <g key={i}>
                  <path d={d} className="stroke-bf-bg-canvas" strokeWidth={px(3)} strokeOpacity={0.7} fill="none" />
                  <path d={d} className="stroke-bf-text-primary" strokeWidth={px(1.25)} fill="none" />
                </g>
              );
            }
            const fillD = voxelFillPath(o.voxels);
            return (
              <g key={i} opacity={o.opacity ?? 1}>
                {o.fill ? <path d={fillD} style={{ fill: o.color }} fillOpacity={o.fill} /> : null}
                {o.hatch ? <path d={fillD} fill={`url(#${hatchColors.get(o.color)})`} /> : null}
                {o.cells ? (
                  <path d={fillD} fill="none" style={{ stroke: o.color }} strokeWidth={px(1)} strokeOpacity={0.55} />
                ) : null}
                {o.outline ? (
                  <OutlinePath
                    d={voxelOutlinePath(o.voxels)}
                    color={o.color}
                    width={px(o.width ?? 1.5)}
                    dashed={o.dashed}
                    dash={o.dash}
                    bare={o.bare}
                    px={px}
                  />
                ) : null}
              </g>
            );
          })}
          {gridPath ? (
            <path d={gridPath} className="stroke-bf-text-primary" strokeOpacity={gridOpacity} strokeWidth={px(1)} fill="none" data-grid />
          ) : null}
          {footprint.length ? (
            <g>
              {/* The exact voxels the brush writes: a light preview fill, so the voxels underneath stay readable. */}
              {brush?.tone === 'blocked' ? (
                <path d={voxelFillPath(footprint)} fill={`url(#${hatchColors.get('var(--bf-warning)')})`} />
              ) : (
                <path
                  d={voxelFillPath(footprint)}
                  style={{ fill: brush?.label ? labelColor(brush.label) : 'var(--bf-text-primary)' }}
                  fillOpacity={BRUSH_PREVIEW_ALPHA}
                  data-brush-preview
                />
              )}
              {/* Its boundary is the cursor: a 1 px neutral line over a light dark halo. */}
              <path d={voxelOutlinePath(footprint)} className="stroke-bf-bg-canvas" strokeOpacity={0.6} strokeWidth={px(2.5)} fill="none" strokeLinecap="square" />
              <path
                d={voxelOutlinePath(footprint)}
                className={brush?.tone === 'blocked' ? 'stroke-bf-warning' : 'stroke-bf-text-primary'}
                strokeWidth={px(1)}
                fill="none"
                strokeLinecap="square"
                data-brush-outline
              />
            </g>
          ) : null}
        </g>

        {ch ? <Crosshair x={ch.x} y={ch.y} w={vw} h={vh} gapAt={gapAt} gap={gap} box={screenBox} ticks={crosshairTicks} /> : null}
        {gutter ? <GutterMarks g={gutter} project={projector.project} vw={vw} vh={vh} /> : null}

        {brushScreen ? (
          <g>
            {/* Hairline centre tick (the disc's centre); no circle: the footprint is the cursor. */}
            <path
              d={`M${brushScreen.x - 4} ${brushScreen.y}h8M${brushScreen.x} ${brushScreen.y - 4}v8`}
              className="stroke-bf-bg-canvas"
              strokeWidth={3}
              strokeOpacity={0.8}
            />
            <path
              d={`M${brushScreen.x - 4} ${brushScreen.y}h8M${brushScreen.x} ${brushScreen.y - 4}v8`}
              className="stroke-bf-text-primary"
              strokeWidth={1}
            />
          </g>
        ) : null}
        {limitGeom.map(({ o, ends }, i) => {
          if (!ends) return null;
          const [a, b] = ends;
          if (o.ticks) {
            // Ticks only, where the line meets the frame: outside the anatomy.
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
            const T = 9;
            const d = `M${a.x} ${a.y}L${a.x + ux * T} ${a.y + uy * T}M${b.x} ${b.y}L${b.x - ux * T} ${b.y - uy * T}`;
            return (
              <g key={`limit${i}`} data-limit="ticks">
                <path d={d} className="stroke-bf-bg-canvas" strokeWidth={3} strokeOpacity={0.6} />
                <path d={d} className="stroke-bf-text-secondary" strokeWidth={1.25} />
              </g>
            );
          }
          return (
            <g key={`limit${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-bf-bg-canvas" strokeWidth={3} strokeOpacity={0.6} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-bf-text-secondary" strokeWidth={1} />
            </g>
          );
        })}
      </svg>

      {gutter ? <GutterBand g={gutter} project={projector.project} vw={vw} vh={vh} /> : null}
      {letters ? (
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: vw, height: vh }}>
          <Letter className="left-1.5 top-1/2 -translate-y-1/2">{lL}</Letter>
          <Letter className="right-1.5 top-1/2 -translate-y-1/2">{lR}</Letter>
          <Letter className="left-1/2 top-1 -translate-x-1/2">{lT}</Letter>
          <Letter className="bottom-1 left-1/2 -translate-x-1/2">{lB}</Letter>
        </div>
      ) : null}
      {zoomLabel ? (
        <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-bf-2xs text-bf-text-muted [text-shadow:0_0_3px_black]">
          {zoomLabel}
        </span>
      ) : null}
      {limitGeom.map(({ o, ends }, i) => {
        if (!ends) return null;
        if (o.ticks) {
          // Unboxed margin label beside a tick, alternating ends so neighbouring labels never collide.
          const [e0, e1] = ends;
          const first = i % 2 === 0;
          const style: React.CSSProperties =
            o.axis === 'y'
              ? (() => {
                  const end = first === e0.x < e1.x ? e0 : e1;
                  return end.x < width / 2 ? { left: 3, top: end.y - 13 } : { right: 3, top: end.y - 13 };
                })()
              : (() => {
                  const end = first === e0.y < e1.y ? e0 : e1;
                  const v: React.CSSProperties = end.y < height / 2 ? { top: 3 } : { bottom: 3 };
                  return end.x > width - 64 ? { ...v, right: width - end.x + 5 } : { ...v, left: end.x + 5 };
                })();
          return (
            <span
              key={`limit-label${i}`}
              className="pointer-events-none absolute whitespace-nowrap font-mono text-bf-2xs leading-none text-bf-text-secondary [text-shadow:0_0_3px_black,0_0_2px_black]"
              style={style}
              data-limit-label
            >
              {o.label}
            </span>
          );
        }
        const a = ends[0];
        return (
          <span
            key={`limit-label${i}`}
            className="pointer-events-none absolute whitespace-nowrap rounded-sm bg-bf-bg-canvas/75 px-1 font-mono text-bf-2xs leading-4 text-bf-text-secondary"
            style={
              o.axis === 'y'
                ? { right: 4, top: a.y - 17 }
                : { left: a.x + 3, ...(i % 2 ? { top: 18 } : { bottom: 16 }) }
            }
          >
            {o.label}
          </span>
        );
      })}
      {overlay ? overlay(projector) : null}
    </div>
  );
}

/**
 * Labels: constant-alpha fills (when on), the active label's faint inset
 * fill, then every label's inner-edge stroke between dark halo rims (just
 * outside the edge and just inside the stroke, never under the colour, so a
 * muted stroke stays light). Halos go down first, so a label's halo never
 * covers its neighbour's colour; one path per label, so overlapping corner
 * bands never double the alpha.
 */
function LabelLayer({ o, px, voxelPx }: { o: LabelOverlay; px: (n: number) => number; voxelPx: number }) {
  const vs = useMemo(() => (o.only ? o.voxels.filter((v) => o.only!.includes(v[2])) : o.voxels), [o.voxels, o.only]);
  const ids = useMemo(() => [...new Set(vs.map((v) => v[2]))].sort((a, b) => a - b), [vs]);
  const active = o.active ?? o.emphasis ?? [];
  const quiet = o.quiet ?? [];
  const filled = o.fill === false ? [] : o.fillOnly ? ids.filter((id) => o.fillOnly!.includes(id)) : ids;
  const fillActive = (o.fillActive ?? []).filter((id) => ids.includes(id) && !filled.includes(id));
  const strokes =
    o.outline === false
      ? []
      : ids
          .map((id) => {
            const em = labelEmphasis(id, active, quiet);
            const st = LABEL_STROKE[em];
            return { id, em, opacity: st.opacity, w: em === 'plain' && o.width ? o.width : st.width };
          })
          // The active label draws last (on top).
          .sort((a, b) => Number(a.em === 'active') - Number(b.em === 'active'));
  const gaps = useMemo(() => (o.gaps !== false && voxelPx >= 6 ? enclosedGaps(vs) : []), [o.gaps, voxelPx, vs]);
  return (
    <g opacity={o.opacity ?? 1} data-labels>
      {filled.map((id) => (
        <path
          key={`f${id}`}
          d={voxelFillPath(vs.filter((v) => v[2] === id).map(([c, r]) => [c, r] as Voxel))}
          style={{ fill: labelColor(id) }}
          fillOpacity={LABEL_FILL_ALPHA}
        />
      ))}
      {fillActive.map((id) => (
        <path
          key={`a${id}`}
          d={voxelFillPath(insetVoxels(vs, id))}
          style={{ fill: labelColor(id) }}
          fillOpacity={ACTIVE_FILL_ALPHA}
          data-active-fill={id}
        />
      ))}
      {strokes.map((st) => (
        <path
          key={`h${st.id}`}
          d={innerBandPath(vs, st.id, -px(0.75), 0) + innerBandPath(vs, st.id, px(st.w), px(st.w + 1))}
          className="fill-bf-bg-canvas"
          opacity={st.em === 'active' || st.em === 'plain' ? 0.6 : 0.35}
          data-halo={st.id}
        />
      ))}
      {strokes.map((st) => (
        <path
          key={`s${st.id}`}
          d={innerBandPath(vs, st.id, 0, px(st.w))}
          style={{ fill: labelColor(st.id) }}
          opacity={st.opacity}
          data-label-stroke={st.id}
          data-emphasis={st.em}
          data-width={st.w}
        />
      ))}
      {gaps.length ? (
        <g data-gaps={gaps.length}>
          {gaps.map(([c, r]) => (
            <circle key={`${c},${r}`} cx={c + 0.5} cy={r + 0.5} r={px(1.5)} className="fill-bf-text-secondary" opacity={0.75} />
          ))}
        </g>
      ) : null}
    </g>
  );
}

/** A point's position along the gutter (screen px), or null outside the image. */
function gutterHit(p: { x: number; y: number }, side: Gutter['side'], vw: number, vh: number): number | null {
  const v = side === 'bottom' ? p.x : p.y;
  return v >= 0 && v <= (side === 'bottom' ? vw : vh) ? v : null;
}

function GutterMarks({ g, project, vw, vh }: { g: Gutter; project: Projector['project']; vw: number; vh: number }) {
  const tick = (at: number, len: number) =>
    g.side === 'bottom' ? `M${at} ${vh}v${len}` : `M${vw} ${at}h${len}`;
  const slices = g.slices
    .map((sl) => ({ at: gutterHit(project(sl.through), g.side, vw, vh), current: sl.current }))
    .filter((t): t is { at: number; current: boolean | undefined } => t.at !== null);
  const limits = g.limits.map((p) => gutterHit(project(p), g.side, vw, vh)).filter((v): v is number => v !== null);
  return (
    <g data-gutter={g.side}>
      <rect
        x={g.side === 'bottom' ? 0 : vw}
        y={g.side === 'bottom' ? vh : 0}
        width={g.side === 'bottom' ? vw + g.size : g.size}
        height={g.side === 'bottom' ? g.size : vh + g.size}
        className="fill-bf-bg-panel-sunken"
      />
      <path d={g.side === 'bottom' ? `M0 ${vh + 0.5}H${vw}` : `M${vw + 0.5} 0V${vh}`} className="stroke-bf-border-subtle" strokeWidth={1} />
      <path d={slices.filter((t) => !t.current).map((t) => tick(t.at, 3)).join('')} className="stroke-bf-text-muted" strokeWidth={1} />
      <path d={limits.map((at) => tick(at, g.size)).join('')} className="stroke-bf-text-secondary" strokeWidth={1} data-gutter-limits={limits.length} />
      {slices
        .filter((t) => t.current)
        .map((t) => (
          <path key="cur" d={tick(t.at, 7)} className="stroke-bf-text-primary" strokeWidth={1.5} data-gutter-current />
        ))}
    </g>
  );
}

/** The gutter's background and zone names (head, body, tail), centred in their zones, dropped when a zone is too short. */
function GutterBand({ g, project, vw, vh }: { g: Gutter; project: Projector['project']; vw: number; vh: number }) {
  const len = g.side === 'bottom' ? vw : vh;
  const cuts = g.limits
    .map((p) => gutterHit(project(p), g.side, vw, vh))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const bounds = [0, ...cuts, len];
  const charPx = 6;
  return (
    <div
      className={clsx('pointer-events-none absolute', g.side === 'bottom' ? 'inset-x-0 bottom-0' : 'inset-y-0 right-0')}
      style={g.side === 'bottom' ? { height: g.size } : { width: g.size }}
      data-testid="ortho-gutter"
    >
      {g.zones.map((name, i) => {
        const a = bounds[i];
        const b = bounds[i + 1];
        if (a === undefined || b === undefined) return null;
        const need = g.side === 'bottom' ? name.length * charPx + 6 : 16;
        if (b - a < need) return null;
        const mid = (a + b) / 2;
        return (
          <span
            key={name}
            className="absolute whitespace-nowrap font-sans text-bf-2xs leading-none text-bf-text-muted"
            style={
              g.side === 'bottom'
                ? { left: mid, bottom: 2, transform: 'translateX(-50%)' }
                : { top: mid, right: 0, width: g.size - 6, textAlign: 'center', transform: 'translateY(-50%)' }
            }
            data-zone={name}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function OutlinePath({
  d,
  color,
  width,
  dashed,
  dash,
  bare,
  px,
}: {
  d: string;
  color: string;
  width: number;
  dashed?: boolean;
  dash?: string;
  bare?: boolean;
  px: (n: number) => number;
}) {
  const pattern = dash
    ? dash
        .split(' ')
        .map((n) => px(Number(n)))
        .join(' ')
    : dashed
      ? `${px(4)} ${px(3)}`
      : undefined;
  return (
    <>
      {bare ? null : (
        <path d={d} fill="none" className="stroke-bf-bg-canvas" strokeOpacity={0.55} strokeWidth={width + px(1.5)} strokeLinecap="butt" strokeDasharray={pattern} />
      )}
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth={width} strokeLinecap="butt" strokeDasharray={pattern} />
    </>
  );
}

/**
 * Achromatic textures for rater disagreement, told apart by form and
 * density (not just angle): A only sparse dots, B only dense hatching,
 * relabelled crossed.
 */
function ReviewPatterns({ uid, px }: { uid: string; px: (n: number) => number }) {
  return (
    <>
      <pattern id={`${uid}-a-only`} patternUnits="userSpaceOnUse" width={px(6)} height={px(6)}>
        <circle cx={px(3)} cy={px(3)} r={px(2)} className="fill-bf-bg-canvas" fillOpacity={0.7} />
        <circle cx={px(3)} cy={px(3)} r={px(1.25)} className="fill-bf-text-primary" />
      </pattern>
      <pattern id={`${uid}-b-only`} patternUnits="userSpaceOnUse" width={px(3)} height={px(3)} patternTransform="rotate(-45)">
        <rect width={px(1)} height={px(3)} className="fill-bf-text-primary" />
      </pattern>
      <pattern id={`${uid}-relabelled`} patternUnits="userSpaceOnUse" width={px(6)} height={px(6)} patternTransform="rotate(45)">
        <rect width={px(1.25)} height={px(6)} className="fill-bf-text-primary" />
        <rect width={px(6)} height={px(1.25)} className="fill-bf-text-primary" />
      </pattern>
    </>
  );
}

function ReviewLayer({ o, uid, px }: { o: ReviewOverlay; uid: string; px: (n: number) => number }) {
  const enc = useMemo(() => {
    const e = reviewEncoding(o.a, o.b);
    if (!o.bNone?.length) return e;
    // A label B never traced is not an "A only" disagreement: it is outlined, with a "B: none" note beside it.
    const none = new Set(o.a.filter((v) => o.bNone!.includes(v[2])).map(([c, r]) => `${c},${r}`));
    return { ...e, aOnly: e.aOnly.filter(([c, r]) => !none.has(`${c},${r}`)) };
  }, [o.a, o.b, o.bNone]);
  const show = o.show ?? 'both';
  const ref = show === 'b' ? o.b : o.a;
  const edges = partitionEdges(ref);
  return (
    <g>
      {(
        [
          [enc.aOnly, 'a-only'],
          [enc.bOnly, 'b-only'],
          [enc.relabelled, 'relabelled'],
        ] as const
      ).map(([vs, id]) =>
        vs.length ? <path key={id} d={voxelFillPath(vs)} fill={`url(#${uid}-${id})`} opacity={0.7} data-texture={id} /> : null,
      )}
      <path d={edges.map((e) => e.d).join('')} fill="none" className="stroke-bf-bg-canvas" strokeOpacity={0.5} strokeWidth={px(2.5)} />
      {edges.map((e) => (
        <path key={e.label} d={e.d} fill="none" style={{ stroke: labelColor(e.label) }} strokeWidth={px(1.25)} strokeLinecap="square" />
      ))}
      {show === 'both' && enc.departures ? (
        <g data-testid="rater-b-departures">
          {/* Mid-grey, thin: B is context for A, not a second heavy chain. */}
          <path d={enc.departures} fill="none" className="stroke-bf-bg-canvas" strokeWidth={px(2.5)} strokeOpacity={0.5} />
          <path d={enc.departures} fill="none" className="stroke-bf-text-muted" strokeWidth={px(1.25)} strokeDasharray={`${px(6)} ${px(3)}`} />
        </g>
      ) : null}
    </g>
  );
}

type Seg = [number, number];

/** Remove [a, b] from a list of 1D segments. */
function cut(segs: Seg[], a: number, b: number): Seg[] {
  return segs.flatMap(([s0, s1]): Seg[] => {
    if (b <= s0 || a >= s1) return [[s0, s1]];
    const out: Seg[] = [];
    if (a > s0) out.push([s0, a]);
    if (b < s1) out.push([b, s1]);
    return out;
  });
}

/**
 * The crosshair: a solid hairline with a light dark halo (the lightest
 * reference mark on the view). It opens a gap around the brush, stops at a
 * clear box (the structure being edited), or shows only as edge ticks.
 */
function Crosshair({
  x,
  y,
  w,
  h,
  gapAt,
  gap,
  box = null,
  ticks = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  gapAt: { x: number; y: number } | null;
  gap: number;
  box?: Box | null;
  ticks?: boolean;
}) {
  const T = 10;
  let hs: Seg[] = ticks ? [[0, T], [w - T, w]] : [[0, w]];
  let vs: Seg[] = ticks ? [[0, T], [h - T, h]] : [[0, h]];
  if (!ticks && box) {
    const m = 6;
    if (y >= box.y0 - m && y <= box.y1 + m) hs = cut(hs, box.x0 - m, box.x1 + m);
    if (x >= box.x0 - m && x <= box.x1 + m) vs = cut(vs, box.y0 - m, box.y1 + m);
  }
  if (!ticks && gapAt && gap > 0) {
    if (Math.abs(gapAt.y - y) < gap) hs = cut(hs, gapAt.x - gap, gapAt.x + gap);
    if (Math.abs(gapAt.x - x) < gap) vs = cut(vs, gapAt.y - gap, gapAt.y + gap);
  }
  const segs: Array<[number, number, number, number]> = [
    ...hs.map(([a, b]): [number, number, number, number] => [a, y, b, y]),
    ...vs.map(([a, b]): [number, number, number, number] => [x, a, x, b]),
  ].filter(([a, b, c, d]) => Math.hypot(c - a, d - b) > 1);
  return (
    <g data-crosshair={ticks ? 'ticks' : box ? 'cleared' : 'full'}>
      {segs.map(([a, b, c, d], i) => (
        <line key={`h${i}`} x1={a} y1={b} x2={c} y2={d} className="stroke-bf-bg-canvas" strokeOpacity={0.45} strokeWidth={2} />
      ))}
      {segs.map(([a, b, c, d], i) => (
        <line key={`c${i}`} x1={a} y1={b} x2={c} y2={d} className="stroke-bf-crosshair" strokeOpacity={0.8} strokeWidth={1} />
      ))}
    </g>
  );
}

function Letter({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'pointer-events-none absolute font-mono text-bf-2xs text-bf-text-muted [text-shadow:0_0_3px_black]',
        className,
      )}
    >
      {children}
    </span>
  );
}
