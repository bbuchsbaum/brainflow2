/**
 * One slice of the reference grid, drawn as SVG over the rendered PNG.
 *
 * Square pixels: one uniform scale (`min(width, height) / fovMm` px per mm)
 * for both axes; the image is upscaled nearest-neighbour so voxels stay
 * honest. Label fills are voxel squares, outlines run along voxel edges, and
 * the brush footprint is the exact voxel set the brush rule writes
 * (`geometry.discFootprint`). The crosshair is green with a dark halo and
 * opens a gap around the brush while drawing; the brush ring is neutral white
 * with a dark halo.
 */

import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  crosshairGapRadius,
  discFootprint,
  LABEL_FILL_ALPHA,
  partitionEdges,
  reviewEncoding,
  voxelFillPath,
  voxelOutlinePath,
  PLANE_LETTERS,
} from './geometry';
import { labelColor } from './mockData';
import type { LabelVoxel, Point, SliceImage, Voxel } from './types';

/**
 * Labels as an exclusive partition (one label per voxel): every voxel filled
 * once at the constant `LABEL_FILL_ALPHA`, outlines only where the label
 * changes, each shared edge drawn once (`geometry.partitionEdges`).
 */
export interface LabelOverlay {
  kind: 'labels';
  voxels: readonly LabelVoxel[];
  /** Fill voxels (default true); false is the outline-only mode. */
  fill?: boolean;
  /** Draw outlines (default true). */
  outline?: boolean;
  /** Outline width, screen px; emphasised labels draw 0.75 px heavier. */
  width?: number;
  /** Labels that own their shared edges and draw heavier (the active label). */
  emphasis?: readonly number[];
  /** Only these labels (hidden labels are not drawn). */
  only?: readonly number[];
  /** Overall opacity of the layer. */
  opacity?: number;
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

/** A landmark limit: a solid labelled line across the view. */
export interface LimitOverlay {
  kind: 'limit';
  axis: 'x' | 'y';
  at: number;
  label: string;
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
}

/** A small neutral glyph in each voxel (locked voxels a proposal skipped). */
export interface MarksOverlay {
  kind: 'marks';
  voxels: readonly Voxel[];
}

export type Overlay = LabelOverlay | VoxelOverlay | SlabOverlay | LimitOverlay | ReviewOverlay | MarksOverlay;

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
  brush?: BrushCursor | null;
  /** Voxel grid lines (only drawn when a voxel is at least 6 px). */
  grid?: boolean;
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

const FALLBACK = { width: 480, height: 360 };

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
  brush,
  grid = false,
  letters = true,
  dim = false,
  zoomLabel,
  overlay,
  className,
  'aria-label': ariaLabel,
}: SliceViewProps) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const s = Math.min(width, height) / fovMm;
  const tx = width / 2 - center[0] * s;
  const ty = height / 2 - center[1] * s;
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
            if (o.kind === 'labels') {
              const vs = o.only ? o.voxels.filter((v) => o.only!.includes(v[2])) : o.voxels;
              const emphasis = o.emphasis ?? [];
              const edges = o.outline === false ? [] : partitionEdges(vs, emphasis);
              const ids = [...new Set(vs.map((v) => v[2]))];
              const w = o.width ?? 1;
              return (
                <g key={i} opacity={o.opacity ?? 1}>
                  {o.fill !== false
                    ? ids.map((id) => (
                        <path
                          key={id}
                          d={voxelFillPath(vs.filter((v) => v[2] === id).map(([c, r]) => [c, r] as Voxel))}
                          style={{ fill: labelColor(id) }}
                          fillOpacity={LABEL_FILL_ALPHA}
                        />
                      ))
                    : null}
                  {edges.length ? (
                    <path
                      d={edges.map((e) => e.d).join('')}
                      fill="none"
                      className="stroke-bf-bg-canvas"
                      strokeOpacity={0.5}
                      strokeWidth={px(w + 1.5)}
                      strokeLinecap="square"
                    />
                  ) : null}
                  {edges.map((e) => (
                    <path
                      key={e.label}
                      d={e.d}
                      fill="none"
                      style={{ stroke: labelColor(e.label) }}
                      strokeWidth={px(emphasis.includes(e.label) ? w + 0.75 : w)}
                      strokeLinecap="square"
                    />
                  ))}
                </g>
              );
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
            <path d={gridPath} className="stroke-bf-text-primary" strokeOpacity={0.14} strokeWidth={px(1)} fill="none" />
          ) : null}
          {footprint.length ? (
            <g>
              {/* The exact voxels the brush writes: filled in the label's colour (preview alpha). */}
              {brush?.tone === 'blocked' ? (
                <path d={voxelFillPath(footprint)} fill={`url(#${hatchColors.get('var(--bf-warning)')})`} />
              ) : (
                <path d={voxelFillPath(footprint)} style={{ fill: brush?.label ? labelColor(brush.label) : 'var(--bf-text-primary)' }} fillOpacity={0.45} />
              )}
              {/* Its boundary is the cursor: neutral white with a dark halo. */}
              <path d={voxelOutlinePath(footprint)} className="stroke-bf-bg-canvas" strokeOpacity={0.85} strokeWidth={px(3)} fill="none" strokeLinecap="square" />
              <path
                d={voxelOutlinePath(footprint)}
                className={brush?.tone === 'blocked' ? 'stroke-bf-warning' : 'stroke-bf-text-primary'}
                strokeWidth={px(1.25)}
                fill="none"
                strokeLinecap="square"
              />
            </g>
          ) : null}
        </g>

        {ch ? <Crosshair x={ch.x} y={ch.y} w={width} h={height} gapAt={gapAt} gap={gap} /> : null}

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
        {limits.map((o, i) => {
          const a = projector.project(o.axis === 'y' ? [0, o.at] : [o.at, 0]);
          const line = o.axis === 'y' ? { x1: 0, y1: a.y, x2: width, y2: a.y } : { x1: a.x, y1: 0, x2: a.x, y2: height };
          return (
            <g key={`limit${i}`}>
              <line {...line} className="stroke-bf-bg-canvas" strokeWidth={3} strokeOpacity={0.6} />
              <line {...line} className="stroke-bf-text-secondary" strokeWidth={1} />
            </g>
          );
        })}
      </svg>

      {letters ? (
        <>
          <Letter className="left-1.5 top-1/2 -translate-y-1/2">{lL}</Letter>
          <Letter className="right-1.5 top-1/2 -translate-y-1/2">{lR}</Letter>
          <Letter className="left-1/2 top-1 -translate-x-1/2">{lT}</Letter>
          <Letter className="bottom-1 left-1/2 -translate-x-1/2">{lB}</Letter>
        </>
      ) : null}
      {zoomLabel ? (
        <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-bf-2xs text-bf-text-muted [text-shadow:0_0_3px_black]">
          {zoomLabel}
        </span>
      ) : null}
      {limits.map((o, i) => {
        const a = projector.project(o.axis === 'y' ? [0, o.at] : [o.at, 0]);
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

/** Achromatic textures for rater disagreement: A only "/", B only "\\", relabelled crossed. */
function ReviewPatterns({ uid, px }: { uid: string; px: (n: number) => number }) {
  const lines = (angle: number, id: string) => (
    <pattern key={id} id={`${uid}-${id}`} patternUnits="userSpaceOnUse" width={px(6)} height={px(6)} patternTransform={`rotate(${angle})`}>
      <rect width={px(1.5)} height={px(6)} className="fill-bf-bg-canvas" fillOpacity={0.75} />
      <rect x={px(1.5)} width={px(1.25)} height={px(6)} className="fill-bf-text-primary" />
    </pattern>
  );
  return (
    <>
      {lines(45, 'a-only')}
      {lines(-45, 'b-only')}
      <pattern id={`${uid}-relabelled`} patternUnits="userSpaceOnUse" width={px(6)} height={px(6)} patternTransform="rotate(45)">
        <rect width={px(1.25)} height={px(6)} className="fill-bf-text-primary" />
        <rect width={px(6)} height={px(1.25)} className="fill-bf-text-primary" />
      </pattern>
    </>
  );
}

function ReviewLayer({ o, uid, px }: { o: ReviewOverlay; uid: string; px: (n: number) => number }) {
  const enc = useMemo(() => reviewEncoding(o.a, o.b), [o.a, o.b]);
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
          <path d={enc.departures} fill="none" className="stroke-bf-bg-canvas" strokeWidth={px(3)} strokeOpacity={0.8} />
          <path d={enc.departures} fill="none" className="stroke-bf-text-primary" strokeWidth={px(1.5)} strokeDasharray={`${px(7)} ${px(3)}`} />
        </g>
      ) : null}
    </g>
  );
}

function Crosshair({
  x,
  y,
  w,
  h,
  gapAt,
  gap,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  gapAt: { x: number; y: number } | null;
  gap: number;
}) {
  // Horizontal and vertical lines, split around the brush while drawing.
  const segs: Array<[number, number, number, number]> = [];
  const hSplit = gapAt && gap > 0 && Math.abs(gapAt.y - y) < gap;
  const vSplit = gapAt && gap > 0 && Math.abs(gapAt.x - x) < gap;
  if (hSplit && gapAt) {
    segs.push([0, y, gapAt.x - gap, y], [gapAt.x + gap, y, w, y]);
  } else segs.push([0, y, w, y]);
  if (vSplit && gapAt) {
    segs.push([x, 0, x, gapAt.y - gap], [x, gapAt.y + gap, x, h]);
  } else segs.push([x, 0, x, h]);
  return (
    <g>
      {segs.map(([a, b, c, d], i) => (
        <line key={`h${i}`} x1={a} y1={b} x2={c} y2={d} className="stroke-bf-bg-canvas" strokeOpacity={0.7} strokeWidth={3} />
      ))}
      {segs.map(([a, b, c, d], i) => (
        <line key={`c${i}`} x1={a} y1={b} x2={c} y2={d} className="stroke-bf-crosshair" strokeWidth={1} strokeDasharray="4 3" />
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
