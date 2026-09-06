import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sliceImagePointToWorld } from '@/components/views/sliceViewer';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';

interface Props {
  display: PopulationSliceDisplay;
  width: number;
  focusedId: string | null;
  selectedIds: ReadonlySet<string>;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onHover?: (world: [number, number, number]) => void;
}

/** A single canvas composes the observed sprite sheet. DOM buttons supply
 * stable identities, keyboard access, focus and selection without 80 viewers. */
export function PopulationCutoutGrid({
  display,
  width,
  focusedId,
  selectedIds,
  onFocus,
  onToggle,
  onHover,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(width);
  const [hover, setHover] = useState<string | null>(null);
  const cutouts = display.data.cutouts;
  const image = display.images.cutouts;
  const availableWidth = Math.max(100, Math.min(width, measuredWidth));
  const columns = Math.max(1, Math.min(8, Math.floor(availableWidth / 105)));
  const cellWidth = availableWidth / columns;
  const imageSize = cellWidth - 8;
  const cellHeight = imageSize + 40;
  const height = Math.ceil((cutouts?.members.length ?? 0) / columns) * cellHeight;

  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setMeasuredWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, availableWidth, height);
    if (!image || !cutouts) return;
    ctx.imageSmoothingEnabled = false;
    const [w, h] = cutouts.plane.dim_px;
    const sourceColumns = Math.min(8, cutouts.members.length);
    for (let i = 0; i < cutouts.members.length; i++) {
      ctx.drawImage(
        image,
        (i % sourceColumns) * w,
        Math.floor(i / sourceColumns) * h,
        w,
        h,
        (i % columns) * cellWidth + 4,
        Math.floor(i / columns) * cellHeight + 4,
        imageSize,
        imageSize,
      );
    }
  }, [image, cutouts, availableWidth, height, columns, cellWidth, cellHeight, imageSize]);
  if (!cutouts || !image) return null;

  return (
    <div aria-label="Individual population cutouts" className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">
        Click to focus. Shift-click or Shift-Enter to change selection. Outlined cells are selected;
        the focused observation has a blue border.
      </p>
      <p aria-live="polite" className="mb-1 h-4 text-xs tabular-nums">
        {hover ?? 'Hover a cutout to inspect its observed value.'}
      </p>
      <div className="max-h-[520px] overflow-y-auto overflow-x-hidden">
        <div ref={container} className="relative" style={{ height }}>
          <canvas
            ref={canvas}
            width={Math.ceil(availableWidth)}
            height={Math.ceil(height)}
            className="pointer-events-none absolute left-0 top-0 bg-black"
            aria-hidden
          />
          <div
            className="absolute inset-0 grid"
            style={{
              width: availableWidth,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: cellHeight,
            }}
          >
            {cutouts.members.map((member, index) => (
              <button
                key={member.memberId}
                type="button"
                aria-label={`Focus cutout ${member.memberId}`}
                aria-current={focusedId === member.memberId ? 'true' : undefined}
                aria-pressed={selectedIds.has(member.memberId)}
                title={`${member.memberId} · ${member.validPixels}/${member.values.length} valid displayed pixels`}
                onClick={(event) =>
                  event.shiftKey ? onToggle(member.memberId) : onFocus(member.memberId)
                }
                onKeyDown={(event) => {
                  if (event.shiftKey && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onToggle(member.memberId);
                  }
                }}
                onMouseMove={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const x = (event.clientX - bounds.left - 4) / imageSize;
                  const y = (event.clientY - bounds.top - 4) / imageSize;
                  if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
                  const [w, h] = cutouts.plane.dim_px;
                  const px = Math.min(w - 1, Math.floor(x * w)),
                    py = Math.min(h - 1, Math.floor(y * h));
                  const value = member.values[py * w + px];
                  const text = `${member.memberId}: ${value === null || !Number.isFinite(value) ? 'unavailable' : value.toPrecision(4)}`;
                  setHover((previous) => (previous === text ? previous : text));
                  onHover?.(sliceImagePointToWorld(px, py, cutouts.plane));
                }}
                className={`relative min-w-0 border p-0 bg-transparent text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${focusedId === member.memberId ? 'border-blue-400' : selectedIds.has(member.memberId) ? 'border-primary/70' : 'border-transparent'}`}
                style={{ gridColumn: (index % columns) + 1 }}
              >
                {member.validPixels === 0 && (
                  <span className="absolute inset-x-0 top-1/3 text-center text-xs text-muted-foreground">
                    No coverage
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-background/95 px-1 py-0.5 text-xs">
                  <span className="block truncate">{member.memberId}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {member.validPixels}/{member.values.length} pixels
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
