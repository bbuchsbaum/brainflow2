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
  discFootprint,
  voxelFillPath,
  voxelOutlinePath,
  PLANE_LETTERS,
} from './geometry';
import { labelColor } from './mockData';
import type { LabelVoxel, Point, SliceImage, Voxel } from './types';

export interface LabelOverlay {
  kind: 'labels';
  voxels: readonly LabelVoxel[];
  /** Fill opacity (0 = none). */
  fill?: number;
  outline?: boolean;
  /** Outline width, screen px. */
  width?: number;
  dashed?: boolean;
  /** Only these labels. */
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
  /** Diagonal hatch in `color` (proposals, disagreement). */
  hatch?: boolean;
  /** Draw every voxel's own square edge (footprints). */
  cells?: boolean;
  opacity?: number;
}

/** A landmark slab: a shaded band between two display coordinates. */
export interface SlabOverlay {
  kind: 'slab';
  axis: 'x' | 'y';
  from: number;
  to: number;
}

export type Overlay = LabelOverlay | VoxelOverlay | SlabOverlay;

export interface BrushCursor {
  center: Point;
  radiusMm: number;
  /** Show the exact voxel footprint under the ring. */
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
  /** Gap (screen px) the crosshair opens around the brush while drawing. */
  crosshairGap?: number;
  brush?: BrushCursor | null;
  /** Voxel grid lines (only drawn when a voxel is at least 6 px). */
  grid?: boolean;
  letters?: boolean;
  /** Dim the image (empty states, protocol picker backdrops). */
  dim?: boolean;
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
  crosshairGap = 0,
  brush,
  grid = false,
  letters = true,
  dim = false,
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
    () => (brush?.footprint ? discFootprint(brush.center, brush.radiusMm) : []),
    [brush?.footprint, brush?.center, brush?.radiusMm],
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

  const ch = crosshair ? projector.project(crosshair) : null;
  const brushScreen = brush ? projector.project(brush.center) : null;
  const brushR = brush ? brush.radiusMm * s : 0;
  const gap = brush && crosshairGap > 0 ? brushR + crosshairGap : 0;
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
              return (
                <g key={i}>
                  <rect {...band} className="fill-bf-text-primary" fillOpacity={0.07} />
                  <path
                    d={edge(o.from) + edge(o.to)}
                    className="stroke-bf-text-secondary"
                    strokeWidth={px(1)}
                    strokeDasharray={`${px(6)} ${px(4)}`}
                    fill="none"
                  />
                </g>
              );
            }
            if (o.kind === 'labels') {
              const ids = o.only ?? [...new Set(o.voxels.map((v) => v[2]))];
              return (
                <g key={i} opacity={o.opacity ?? 1}>
                  {ids.map((id) => {
                    const vs = o.voxels.filter((v) => v[2] === id).map(([c, r]) => [c, r] as Voxel);
                    if (!vs.length) return null;
                    const color = labelColor(id);
                    return (
                      <g key={id}>
                        {o.fill ? <path d={voxelFillPath(vs)} style={{ fill: color }} fillOpacity={o.fill} /> : null}
                        {o.outline ? (
                          <OutlinePath d={voxelOutlinePath(vs)} color={color} width={px(o.width ?? 1.5)} dashed={o.dashed} px={px} />
                        ) : null}
                      </g>
                    );
                  })}
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
                  <OutlinePath d={voxelOutlinePath(o.voxels)} color={o.color} width={px(o.width ?? 1.5)} dashed={o.dashed} px={px} />
                ) : null}
              </g>
            );
          })}
          {gridPath ? (
            <path d={gridPath} className="stroke-bf-text-primary" strokeOpacity={0.14} strokeWidth={px(1)} fill="none" />
          ) : null}
          {footprint.length ? (
            <g>
              <path
                d={voxelFillPath(footprint)}
                className={brush?.tone === 'blocked' ? 'fill-bf-warning' : 'fill-bf-text-primary'}
                fillOpacity={0.2}
              />
              {/* Every voxel the brush will write, cell by cell. */}
              <path
                d={voxelFillPath(footprint)}
                fill="none"
                className={brush?.tone === 'blocked' ? 'stroke-bf-warning' : 'stroke-bf-text-primary'}
                strokeOpacity={0.45}
                strokeWidth={px(1)}
              />
              <path
                d={voxelOutlinePath(footprint)}
                className={brush?.tone === 'blocked' ? 'stroke-bf-warning' : 'stroke-bf-text-primary'}
                strokeWidth={px(1.5)}
                fill="none"
              />
            </g>
          ) : null}
        </g>

        {ch ? <Crosshair x={ch.x} y={ch.y} w={width} h={height} gapAt={brushScreen} gap={gap} /> : null}

        {brushScreen ? (
          <g>
            <circle cx={brushScreen.x} cy={brushScreen.y} r={brushR} fill="none" className="stroke-bf-bg-canvas" strokeOpacity={0.8} strokeWidth={3} />
            <circle
              cx={brushScreen.x}
              cy={brushScreen.y}
              r={brushR}
              fill="none"
              className={brush?.tone === 'blocked' ? 'stroke-bf-warning' : 'stroke-bf-text-primary'}
              strokeWidth={1.25}
            />
            <circle cx={brushScreen.x} cy={brushScreen.y} r={1.25} className="fill-bf-text-primary" />
          </g>
        ) : null}
      </svg>

      {letters ? (
        <>
          <Letter className="left-1.5 top-1/2 -translate-y-1/2">{lL}</Letter>
          <Letter className="right-1.5 top-1/2 -translate-y-1/2">{lR}</Letter>
          <Letter className="left-1/2 top-1 -translate-x-1/2">{lT}</Letter>
          <Letter className="bottom-1 left-1/2 -translate-x-1/2">{lB}</Letter>
        </>
      ) : null}
      {overlay ? overlay(projector) : null}
    </div>
  );
}

function OutlinePath({
  d,
  color,
  width,
  dashed,
  px,
}: {
  d: string;
  color: string;
  width: number;
  dashed?: boolean;
  px: (n: number) => number;
}) {
  return (
    <>
      <path d={d} fill="none" className="stroke-bf-bg-canvas" strokeOpacity={0.55} strokeWidth={width + px(1.5)} strokeLinecap="square" strokeDasharray={dashed ? `${px(4)} ${px(3)}` : undefined} />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth={width} strokeLinecap="square" strokeDasharray={dashed ? `${px(4)} ${px(3)}` : undefined} />
    </>
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
