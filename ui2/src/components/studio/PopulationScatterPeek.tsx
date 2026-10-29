/**
 * The floating slice peek over the relationship scatter (W1 UI).
 *
 * Presentation only: it shows one observation's slice from the scatter's
 * `PopulationPeekService` snapshot. It never changes focus, the Inspector,
 * the shared crosshair or the lens's slice. Its own slice starts at the
 * shared one; the wheel over the image steps it, the segmented control
 * switches plane, and the value under the pointer is read from the raster.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Pin, PinOff, X } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '@/components/ui/bf';
import {
  ReusableSliceViewport,
  SliceViewerImageSurface,
  clientPointToWorld,
  type SliceViewerPlacement,
} from '@/components/views/sliceViewer';
import {
  populationAxisLabel,
  populationRgba,
  type PopulationOrientation,
} from '@/services/studio/PopulationSliceService';
import { peekValueAt, type PopulationPeekSnapshot } from '@/services/studio/PopulationPeekService';
import type { ViewPlane } from '@/types/coordinates';
import {
  NORMAL_AXIS,
  PEEK_WIDTH,
  peekStepPlane,
  steppedPeekView,
  type PopulationPeekView,
} from './relationshipPresentation';
export type { PopulationPeekView } from './relationshipPresentation';
import { formatWorldMm } from '@/utils/valueFormat';


const IMAGE_SIZE = 208;

const PLANES: { value: PopulationOrientation; label: string; title: string }[] = [
  { value: 'axial', label: 'A', title: 'Axial' },
  { value: 'coronal', label: 'C', title: 'Coronal' },
  { value: 'sagittal', label: 'S', title: 'Sagittal' },
];


export function PopulationScatterPeek({
  id,
  memberId,
  view,
  snapshot,
  effectLimit,
  pinned,
  position,
  onViewChange,
  onPinnedChange,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  /** DOM id, so the previewed point can reference the peek (`aria-describedby`). */
  id?: string;
  memberId: string;
  view: PopulationPeekView;
  snapshot: PopulationPeekSnapshot;
  /** The lens's shared effect colour range (± limit). */
  effectLimit: number;
  pinned: boolean;
  position: { left: number; top: number };
  onViewChange: (view: PopulationPeekView) => void;
  onPinnedChange: (pinned: boolean) => void;
  onClose: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const raster = snapshot.raster?.memberId === memberId ? snapshot.raster : null;
  const [image, setImage] = useState<{ bitmap: ImageBitmap; plane: ViewPlane } | null>(null);
  useEffect(() => {
    if (!raster || typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') {
      setImage(null);
      return;
    }
    let cancelled = false;
    const [w, h] = raster.plane.dim_px;
    const pixels = new ImageData(w, h);
    pixels.data.set(populationRgba(raster.values, effectLimit, true));
    void createImageBitmap(pixels).then(
      (bitmap) => {
        if (cancelled) bitmap.close();
        else setImage({ bitmap, plane: raster.plane });
      },
      () => {
        if (!cancelled) setImage(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [raster, effectLimit]);
  useEffect(() => () => image?.bitmap.close(), [image]);

  // The wheel over the image steps only the peek's slice. A native,
  // non-passive listener so the page and the plot do not scroll as well.
  const wheelHost = useRef<HTMLDivElement>(null);
  const step = useRef<(direction: number) => void>(() => {});
  step.current = (direction) =>
    onViewChange(steppedPeekView(view, direction, peekStepPlane(raster, view)));
  useEffect(() => {
    const host = wheelHost.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY) step.current(event.deltaY < 0 ? 1 : -1);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const placement = useRef<SliceViewerPlacement | null>(null);
  const [pointer, setPointer] = useState<{
    world: [number, number, number];
    value: number | null;
  } | null>(null);
  useEffect(() => setPointer(null), [raster]);
  const axis = NORMAL_AXIS[view.orientation];
  const planeTitle = PLANES.find((p) => p.value === view.orientation)!.title;
  // The label describes the image shown: the raster's slice when it is in the
  // view's plane, with the requested slice while a new one loads.
  const shown = raster && raster.orientation === view.orientation ? raster : null;
  const shownMm = (shown ?? view).crosshairMm[axis.index];
  const wantedMm = view.crosshairMm[axis.index];
  const readout =
    pointer === null
      ? 'Point at the image for its value'
      : pointer.value === null
        ? 'No finite value here'
        : `Value ${pointer.value.toPrecision(4)}`;
  const openInViewerNote = useId();
  return (
    <div
      id={id}
      role="dialog"
      aria-label={`Preview of ${memberId}`}
      data-pinned={pinned || undefined}
      className="absolute z-20 flex flex-col gap-1.5 rounded-sm border border-bf-border-strong bg-bf-bg-panel-raised p-2 text-bf-sm shadow-bf-panel"
      style={{ left: position.left, top: position.top, width: PEEK_WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono">{memberId}</span>{' '}
          <span className="text-bf-text-muted">{pinned ? 'pinned preview' : 'preview'}</span>
        </span>
        <IconButton
          size="xs"
          variant="ghost"
          icon={pinned ? <PinOff size={12} /> : <Pin size={12} />}
          pressed={pinned}
          aria-label={pinned ? 'Unpin preview' : 'Pin preview'}
          title={pinned ? 'Unpin preview' : 'Keep the preview open while you step or scroll'}
          onClick={() => onPinnedChange(!pinned)}
        />
        <IconButton
          size="xs"
          variant="ghost"
          icon={<X size={12} />}
          aria-label="Close preview"
          title="Close preview (Escape)"
          onClick={onClose}
        />
      </div>
      <SegmentedControl
        size="sm"
        aria-label="Preview plane"
        options={PLANES.map((p) => ({
          value: p.value,
          label: p.label,
          title: p.title,
          'aria-label': p.title,
        }))}
        value={view.orientation}
        onValueChange={(value) =>
          onViewChange({ ...view, orientation: value as PopulationOrientation })
        }
      />
      <div
        ref={wheelHost}
        data-testid="peek-image"
        className="relative self-center bg-bf-bg-canvas"
        style={{ width: IMAGE_SIZE, height: IMAGE_SIZE }}
        aria-label={`${planeTitle} slice of ${memberId}; scroll to step the slice`}
        onMouseMove={(event) => {
          if (!raster || !canvas.current || !placement.current) return;
          const world = clientPointToWorld(
            event.clientX,
            event.clientY,
            canvas.current,
            placement.current,
            raster.plane,
          );
          const value = world ? peekValueAt(raster, world) : undefined;
          setPointer(world && value !== undefined ? { world, value } : null);
        }}
        onMouseLeave={() => setPointer(null)}
      >
        <ReusableSliceViewport
          width={IMAGE_SIZE}
          height={IMAGE_SIZE}
          viewPlane={image?.plane ?? raster?.plane}
          onCanvasReady={(element) => {
            canvas.current = element;
          }}
          onPlacementChange={(next) => {
            placement.current = next;
          }}
          renderSurface={(props) => (
            <SliceViewerImageSurface
              {...props}
              image={image?.bitmap ?? null}
              emptyFallback={
                <p className="absolute inset-0 grid place-items-center px-2 text-center text-bf-xs text-bf-text-muted">
                  {snapshot.error ?? (snapshot.pending ? 'Loading slice…' : 'No slice')}
                </p>
              }
            />
          )}
        />
        {raster && (
          <div
            className="pointer-events-none absolute inset-0 text-bf-xs text-bf-text-secondary"
            aria-hidden
          >
            <span className="absolute left-1 top-1/2">
              {populationAxisLabel(raster.plane.u_mm.map((v) => -v))}
            </span>
            <span className="absolute right-1 top-1/2">
              {populationAxisLabel(raster.plane.u_mm)}
            </span>
            <span className="absolute left-1/2 top-1">
              {populationAxisLabel(raster.plane.v_mm.map((v) => -v))}
            </span>
            <span className="absolute bottom-1 left-1/2">
              {populationAxisLabel(raster.plane.v_mm)}
            </span>
          </div>
        )}
        {snapshot.pending && raster && (
          <span className="absolute right-1 top-1 text-bf-xs text-bf-text-muted">Updating…</span>
        )}
      </div>
      <p className="m-0 flex justify-between gap-2 font-mono text-bf-xs tabular-nums">
        <span data-testid="peek-slice" role="status">
          {planeTitle} · {axis.name} {formatWorldMm(shownMm)} mm
          {shownMm !== wantedMm && ` → ${formatWorldMm(wantedMm)}`}
        </span>
        <span className="truncate text-bf-text-secondary" aria-live="off">
          {readout}
        </span>
      </p>
      {snapshot.error && raster && (
        <p className="m-0 text-bf-xs text-bf-text-muted" role="alert">
          {snapshot.error}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        aria-disabled
        aria-describedby={openInViewerNote}
        title="Opening an observation in the viewer is not available yet."
        onClick={(event) => event.preventDefault()}
      >
        Open in viewer
      </Button>
      <span id={openInViewerNote} className="sr-only">
        Not available yet: opening an observation in the viewer arrives in a later release.
      </span>
    </div>
  );
}
