import { useLayoutEffect, useState } from 'react';
import { asciiCopyHandler } from '@/utils/numericInput';
import {
  PLANE_NAME,
  headerMaxWidth,
  headerParts,
  type FramePlane,
  type HeaderParts,
} from './frameFormat';

interface ViewportHeaderProps {
  plane: FramePlane;
  /** World position (mm) of the slice along the plane's normal axis. */
  positionMm: number;
  /** Selected / active layer name; omitted when the frame owner shows it elsewhere. */
  layerName?: string | null;
  /** Size of the canvas area the header sits in (CSS px). */
  width: number;
  height: number;
  /** Receives the header element, e.g. to register it as a crosshair knockout. */
  elementRef?: (el: HTMLDivElement | null) => void;
  /**
   * World range of the slice axis (e.g. the volume's extent). Layout is
   * decided from the widest position this range can produce, so the header
   * never appears / disappears or re-truncates while scrubbing.
   */
  rangeMm?: readonly [number, number] | null;
  /** Show the plane word (default). Compare states the plane in its toolbar. */
  showPlane?: boolean;
  /** Keep the (truncated) name even in the compact form: the panel's identity. */
  requireName?: boolean;
}

/**
 * Viewport header overlay: plane, slice position and layer, drawn inside the
 * canvas area's top-left margin. Absolutely positioned, so it never takes
 * layout height and slice placement is unaffected. Its width is capped at half
 * the view minus a margin so it never reaches the top-centre orientation
 * letter. The scrim (canvas at 80%) keeps secondary text ≥4.5:1 even over
 * white matter; over the black margin it is invisible.
 *
 * Two forms, chosen by width (`headerParts`): full "Axial  z −0.5 mm  name"
 * and compact "z −0.5"; hidden below 90px of height. The whole header is
 * `pointer-events: none`, so a click on any part of it (name included) reaches
 * the image and sets the crosshair; the untruncated name is in the header's
 * accessible label and in the status bar's Layer slot.
 */
export function ViewportHeader({
  plane,
  positionMm,
  layerName,
  width,
  height,
  elementRef,
  rangeMm = null,
  showPlane = true,
  requireName = false,
}: ViewportHeaderProps) {
  // Hysteresis memory: a roomier form needs a few px of spare width before
  // it replaces the compact one, so a pane at the boundary does not toggle.
  // Kept in state and committed in a layout effect (no render-phase writes);
  // re-rendering with the committed density yields the same form, so this
  // settles in one pass.
  const [previous, setPrevious] = useState<HeaderParts['density'] | null>(null);
  const visible = height >= 90;
  const maxWidth = headerMaxWidth(width);
  const parts = visible
    ? headerParts(plane, positionMm, layerName, maxWidth, {
        rangeMm,
        showPlane,
        requireName,
        previous,
      })
    : null;
  const density = parts?.density ?? null;
  useLayoutEffect(() => {
    setPrevious((cur) => (cur === density ? cur : density));
  }, [density]);
  if (!parts) return null;
  const label = [PLANE_NAME[plane], parts.position, parts.fullName]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      ref={elementRef}
      data-testid="viewport-header"
      data-density={parts.density}
      role="group"
      aria-label={label}
      onCopy={asciiCopyHandler}
      className="pointer-events-none absolute left-1.5 top-1 z-10 flex min-w-0 select-none items-baseline gap-2 overflow-hidden whitespace-nowrap rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)] text-bf-xs text-bf-text-secondary"
      style={{ maxWidth: maxWidth + (parts.density === 'compact' ? 3 : 0), padding: parts.density === 'compact' ? '0 2px' : '0 4px' }}
    >
      {parts.plane && <span className="shrink-0">{parts.plane}</span>}
      <span className="shrink-0 font-mono tabular-nums">{parts.position}</span>
      {parts.name && (
        <span className="min-w-0 truncate text-bf-text-muted" data-testid="viewport-header-name">
          {parts.name}
        </span>
      )}
    </div>
  );
}
