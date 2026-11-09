import { projectWorldToCanvas } from '@brainflow/visualization/slice';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SegmentationPreview, SegmentationSlice, SegmentationStroke } from '@brainflow/api';
import { Button, EmptyPane, IconButton } from '@/components/ui/bf';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { SliceViewport, captureActiveWorkspace, useActiveWorkspaceId, getModuleViewportTool, formatModuleError, isLiveDocument, isDocumentEditingFrozen, removeModuleLayers, useLoadedVolumeLayers, useModuleCrosshairStyle, useVolumeResidencyKey, type ViewportPointerSample, type ViewportTool } from '@/modules/api/host';
import { ensureModuleImageLayer, ensureModuleLabelLayer, renderModulePlane, resizeZoomedPlane, setModuleCrosshair, useHasRenderedImage, useWorkspaceRenderState, zoomPanPlane, type RenderContext, type SliceViewportPlacement, type ViewPlane } from '@/modules/api/rendering';
import { commitSegmentationStroke, getSegmentationSession, reconcileSegmentationSession, setSegmentationLabelState, segmentationFrameCounts, segmentationFrames, segmentationSaveState, setSegmentationPresentation, useSegmentationSession } from '@/modules/segmentation/session';
import { bindSegmentationViewport } from '@/modules/segmentation/toolBindings';
import { brushRadiusPx, drawTracingOverlay, labelSliceVoxels, nativeSliceAtWorld, tracingClearance } from '@/modules/segmentation/components/shared/TracingOverlay';
import { labelIslands } from '@/modules/segmentation/components/shared/geometry';
import { ConstraintStripView } from '@/modules/segmentation/components/shared/ConstraintStripView';
import { TracingTools } from '@/modules/segmentation/components/shared/TracingTools';
import { ContextViews } from './ContextViews';
import { NativeSliceRuler } from '@/modules/segmentation/components/shared/SliceProgress';
import { numericEntryHandlers } from '@/modules/segmentation/components/shared/numericEntry';

const viewPlane = (slice: SegmentationSlice): ViewPlane => ({ ...slice.plane, dim_px: [slice.plane.width_px, slice.plane.height_px] });
const text = formatModuleError;
/** Trackpad scroll (px) per native slice; a wheel notch of at least this much is one slice. */
export const WHEEL_STEP_PX = 30;

export function SegmentViewport({ workspaceId }: { workspaceId: string }) {
  const session = useSegmentationSession(workspaceId);
  const isFront = useActiveWorkspaceId() === workspaceId;
  const workspaceView = useWorkspaceRenderState(workspaceId);
  const crosshairStyle = useModuleCrosshairStyle();
  const loadedLayers = useLoadedVolumeLayers();
  const [displayPlacement, setDisplayPlacement] = useState<SliceViewportPlacement | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<[number, number]>([512, 512]);
  // The last fetched slice and the native index it belongs to. It is kept
  // while the next one loads, so stepping never blanks the view.
  const [sliceState, setSliceState] = useState<{ index: number; data: SegmentationSlice } | null>(null);
  const slice = sliceState?.data ?? null;
  const sliceSeq = useRef(0), sliceApplied = useRef(0);
  // The frame on screen: the plane it was drawn for and the slice whose labels go with it.
  const [shown, setShown] = useState<{ key: string; plane: ViewPlane; index: number; slice: SegmentationSlice } | null>(null);
  const renderSeq = useRef(0), shownSeq = useRef(0);
  const planeSlice = useRef<{ index: number; data: SegmentationSlice } | null>(null);
  const [preview, setPreview] = useState<SegmentationPreview | null>(null);
  const [cursorWorld, setCursorWorld] = useState<[number, number, number] | null>(null);
  // The pointer over the image, in canvas px (null when it is elsewhere).
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // A brief note at the pointer about a stroke that was not applied.
  // `at` restarts the timer when the same note repeats.
  const [hint, setHintState] = useState<{ text: string; at: number } | null>(null);
  const setHint = useCallback((text: string | null) => setHintState(text ? { text, at: performance.now() } : null), []);
  const [framing, setFraming] = useState<{ plane: ViewPlane; index: number } | null>(null);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [layerReady, setLayerReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [contrast, setContrast] = useState<'reference' | 'secondary'>('reference');
  const [renderedFrame, setRenderedFrame] = useState('');
  // The radius as typed: may be empty or out of range while retyping; only valid values apply.
  // `base` is the store radius the draft belongs to; a change from elsewhere drops the draft.
  const [radiusDraft, setRadiusDraft] = useState<{ text: string; base: number } | null>(null);
  const ready = useRef(false);
  // Wheel stepping: the index a step builds on until the store catches up (several
  // wheel events can land before a render), and the unspent trackpad scroll.
  const stepBase = useRef<number | null>(null), wheelRest = useRef(0);
  if (stepBase.current !== null && stepBase.current === session?.sliceIndex) stepBase.current = null;
  const mounted = useRef(true);
  // One slice fetch and one render in flight; while one runs, only the latest request waits.
  const fetcher = useRef<{ busy: boolean; want: { index: number; size: [number, number]; record: NonNullable<ReturnType<typeof getSegmentationSession>> } | null }>({ busy: false, want: null });
  const renderer = useRef<{ busy: boolean; want: (() => Promise<void>) | null }>({ busy: false, want: null });
  // Bumped when the tab is left: a render started before then is abandoned.
  const renderGen = useRef(0);
  const placement = useRef<SliceViewportPlacement | null>(null);
  const state = useRef(session); state.current = session;
  const active = session?.info?.snapshot;
  const labelVolumeId = session?.info?.labelVolumeId, paletteId = session?.info?.paletteId, identity = session?.document;
  // A 4D source is displayed from its session-owned frozen frame, never the shared time cursor.
  const referenceDisplayId = session?.info?.referenceDisplayVolumeId, secondaryDisplayId = session?.info?.secondaryDisplayVolumeId ?? null;
  const frameLayers = useMemo(() => [
    referenceDisplayId && active && referenceDisplayId !== active.referenceVolumeId ? { volumeId: referenceDisplayId, displayLike: active.referenceVolumeId, title: `Segmentation reference · frame ${(active.referenceFrame ?? 0) + 1}` } : null,
    secondaryDisplayId && active?.secondaryVolumeId && secondaryDisplayId !== active.secondaryVolumeId ? { volumeId: secondaryDisplayId, displayLike: active.secondaryVolumeId, title: `Segmentation secondary · frame ${(active.secondaryFrame ?? 0) + 1}` } : null,
  ].filter((layer): layer is { volumeId: string; displayLike: string; title: string } => layer !== null), [referenceDisplayId, secondaryDisplayId, active]);
  const frameLayerKey = JSON.stringify(frameLayers);
  const maxLabel = Math.max(1, ...(active?.labels.map((row) => row.definition.id) ?? []));
  const stroke = useRef<Omit<SegmentationStroke, 'owner'> | null>(null);
  const previewFrame = useRef<number | null>(null);
  const panKey = useRef(false);
  const pan = useRef<{ x: number; y: number; plane: ViewPlane } | null>(null);
  const candidatePlane = useMemo(() => {
    // Until the current index's slice arrives, hold the plane (undefined).
    if (!sliceState || !active) return null;
    if (sliceState.index !== session?.sliceIndex) return undefined;
    const slice = sliceState.data;
    if (!framing) return viewPlane(slice);
    const resized = resizeZoomedPlane(framing.plane, size);
    const offset = session.sliceIndex - framing.index;
    return { ...resized, origin_mm: resized.origin_mm.map((v, axis) => v + active.voxelToWorld[4 * active.normalAxis + axis] * offset) as [number, number, number] };
  }, [sliceState, active, framing, size, session?.sliceIndex]);
  const stablePlane = useRef<ViewPlane | null>(null);
  if (candidatePlane !== undefined && JSON.stringify(stablePlane.current) !== JSON.stringify(candidatePlane)) { stablePlane.current = candidatePlane; planeSlice.current = sliceState; }
  const plane = stablePlane.current;
  const sourceId = contrast === 'secondary' && active?.registration?.status === 'aligned' ? secondaryDisplayId ?? referenceDisplayId : referenceDisplayId;
  const frameKey = JSON.stringify([plane, sourceId]);
  // Changes when the traced image is evicted or uploaded again: the frame on
  // screen no longer reflects the GPU, so it is drawn again.
  const sourceResidency = useVolumeResidencyKey(sourceId ? [sourceId] : []);
  const contextId = `segmentation-${workspaceId}-primary`;
  // The frame is drawn only while its image is still in the render store
  // (the viewport's unmount drops it): never trace on an empty canvas.
  const hasImage = useHasRenderedImage(contextId);
  const [redraw, setRedraw] = useState(0);
  // A drawn frame stays on screen while the next one renders; tracing waits
  // until the frame on screen is the current slice at the current revision.
  const visible = Boolean(isFront && session && shown && layerReady && hasImage && !displayError && !session.info?.renderError);
  ready.current = Boolean(visible && shown?.key === frameKey && renderedFrame === frameKey && sliceState?.index === session?.sliceIndex && slice && slice.revision === active?.revision);
  const context = useMemo<RenderContext>(() => ({ id: contextId, type: 'slice', dimensions: { width: size[0], height: size[1] }, metadata: { workspaceId }, viewPlane: plane ?? undefined }), [contextId, workspaceId, size, plane]);
  const displayContext = useMemo<RenderContext>(() => ({ ...context, viewPlane: shown?.plane ?? context.viewPlane }), [context, shown?.plane]);
  // The labels drawn over the frame: the freshest fetch for the shown slice.
  const overlaySlice = shown ? (sliceState && sliceState.index === shown.index ? sliceState.data : shown.slice) : null;
  const report = useCallback((error: unknown) => setSegmentationPresentation(workspaceId, { error: text(error) }), [workspaceId]);
  useEffect(() => { if (!hint) return; const timer = setTimeout(() => setHintState(null), 2500); return () => clearTimeout(timer); }, [hint]);

  useEffect(() => {
    const target = container.current; if (!target) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) { const width = Math.max(1, Math.round(entry.contentRect.width)), height = Math.max(1, Math.round(entry.contentRect.height)); setSize((old) => old[0] === width && old[1] === height ? old : [width, height]); }
    });
    observer.observe(target); return () => observer.disconnect();
  }, []);
  useEffect(() => { void reconcileSegmentationSession(workspaceId); }, [workspaceId]);
  // Leaving the tab unmounts the viewport, which drops its image from the
  // render store; the frame key must go with it, or on return the viewport
  // is declared ready on an empty (black) canvas before any frame is drawn.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!isFront) { renderGen.current++; renderer.current.want = null; setRenderedFrame(''); setShown(null); } }, [isFront]);
  // A frame believed drawn whose image is gone (its viewport unmounted after
  // the image landed) is drawn again, without user action.
  useEffect(() => {
    if (isFront && renderedFrame && renderedFrame === frameKey && !hasImage) { setRenderedFrame(''); setShown(null); setRedraw((n) => n + 1); }
  }, [isFront, renderedFrame, frameKey, hasImage]);
  useEffect(() => {
    let disposed = false;
    if (!isFront || !labelVolumeId || paletteId == null || !identity) { setLayerReady(false); return; }
    const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent() && isLiveDocument(identity);
    setLayerReady(false);
    void (async () => {
      const frames = JSON.parse(frameLayerKey) as { volumeId: string; displayLike: string; title: string }[];
      for (const frame of frames) {
        try { await ensureModuleImageLayer({ workspaceId, ...frame, isCurrent: current }); } finally {
          // A discard may have taken its layer list while this add was still
          // pending; remove frame layers that outlived their document.
          if (!isLiveDocument(identity)) await removeModuleLayers(frames.map((item) => item.volumeId));
        }
      }
      await ensureModuleLabelLayer({ workspaceId, volumeId: labelVolumeId, kind: 'segmentation.editable-label', title: 'Segmentation labels', paletteId, maxLabel, isCurrent: current });
    })().then(() => { if (current()) setLayerReady(true); }).catch((error) => { if (current()) setDisplayError(text(error)); });
    return () => { disposed = true; };
  }, [workspaceId, labelVolumeId, paletteId, identity, maxLabel, attempt, isFront, frameLayerKey]);
  useEffect(() => {
    const record = getSegmentationSession(workspaceId);
    if (!isFront || !record || !active?.sessionId) return;
    setPreview(null);
    const f = fetcher.current;
    // The request carries its session: a fetch still running for an old one pumps the new one.
    f.want = { index: session?.sliceIndex ?? 0, size, record };
    const pump = () => {
      if (f.busy || !f.want || !mounted.current) return;
      const { index, size: dims, record: owner } = f.want; f.want = null; f.busy = true;
      const seq = ++sliceSeq.current;
      void owner.controller.slice(index, dims)
        .then((result) => { if (mounted.current && result && seq > sliceApplied.current) { sliceApplied.current = seq; setSliceState({ index, data: result }); } })
        .catch((error) => { if (mounted.current && !f.want) report(error); })
        .finally(() => { f.busy = false; pump(); });
    };
    pump();
    return () => { record.controller.cancelPreview(); };
  }, [workspaceId, active?.sessionId, active?.revision, session?.sliceIndex, size, report, isFront]);
  useEffect(() => {
    if (!isFront || !plane || !sourceId || !layerReady) { renderer.current.want = null; return; }
    const r = renderer.current, at = planeSlice.current;
    // A newer request replaces a waiting one; the one in flight finishes and may
    // still be shown (it is newer than what is on screen), so a gesture shows frames.
    r.want = () => {
      const lease = captureActiveWorkspace(), seq = ++renderSeq.current, gen = renderGen.current, sliceAt = sliceApplied.current;
      const current = () => mounted.current && gen === renderGen.current && lease?.workspaceId === workspaceId && lease.isCurrent() && seq > shownSeq.current;
      return renderModulePlane({ workspaceId, context, plane, volumeIds: [sourceId], isCurrent: current }).then(() => {
        if (!current() || !at) return;
        shownSeq.current = seq; setShown({ key: frameKey, plane, index: at.index, slice: at.data }); setRenderedFrame(frameKey);
      }).catch((error) => {
        if (!current()) return;
        // Superseded (a newer render or slice is on its way): draw again rather than
        // stop on an error for a frame nobody is waiting for.
        const f = fetcher.current;
        if (r.want || f.busy || f.want || sliceApplied.current !== sliceAt) { setRedraw((k) => k + 1); return; }
        setDisplayError(text(error));
      });
    };
    const pump = () => {
      if (r.busy || !r.want || !mounted.current) return;
      const run = r.want; r.want = null; r.busy = true;
      void run().finally(() => { r.busy = false; pump(); });
    };
    pump();
  }, [workspaceId, plane, context, sourceId, frameKey, workspaceView?.layers, layerReady, attempt, isFront, sourceResidency, redraw]);

  const queuePreview = useCallback(() => {
    if (previewFrame.current !== null) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null;
      const input = stroke.current, record = getSegmentationSession(workspaceId);
      if (!input || !record || (input.tool === 'contour' && input.pointsWorld.length < 3)) return;
      void record.controller.preview({ ...input, pointsWorld: [...input.pointsWorld] }).then((result) => { if (result && stroke.current === input) setPreview(result); }).catch(report);
    });
  }, [workspaceId, report]);
  const append = (samples: readonly ViewportPointerSample[]) => {
    const drawing = stroke.current; if (!drawing) return;
    for (const sample of samples) {
      if (!sample.world) { stroke.current = null; setPreview(null); setHint('Stroke cancelled outside the reference image.'); return; }
      if (drawing.pointsWorld.length >= 4096) { stroke.current = null; setHint('Stroke is too long. Use several shorter strokes.'); return; }
      drawing.pointsWorld.push([...sample.world]); setCursorWorld([...sample.world]);
    }
  };
  const pointer = useMemo<ViewportTool>(() => ({
    pointerDown(samples) {
      const live = state.current;
      if (!live || live.tool === 'navigate' || panKey.current) return false;
      if (!ready.current || live.busy || !isLiveDocument(live.document) || isDocumentEditingFrozen(workspaceId)) return true;
      const point = samples.at(-1)?.world; if (point) setCursorWorld([...point]);
      setPreview(null);
      const label = live.info?.snapshot.labels.find((row) => row.definition.id === live.activeLabelId);
      if (!label || label.locked) { report('The active label is locked. Unlock it in the Inspector before tracing.'); return true; }
      setHint(null);
      stroke.current = { labelId: live.activeLabelId, sliceIndex: live.sliceIndex, tool: live.tool, radiusMm: live.radiusMm, paintOver: live.paintOver, pointsWorld: [] };
      append(samples); queuePreview(); return true;
    },
    pointerMove(samples) { if (!ready.current) { stroke.current = null; setPreview(null); return; } append(samples); queuePreview(); },
    pointerUp(samples) {
      if (!ready.current) { stroke.current = null; setPreview(null); getSegmentationSession(workspaceId)?.controller.cancelPreview(); return; }
      append(samples);
      const drawing = stroke.current; stroke.current = null;
      getSegmentationSession(workspaceId)?.controller.cancelPreview();
      // A click or a very short drag is not a contour: say how the tool works instead of failing.
      if (drawing?.tool === 'contour' && drawing.pointsWorld.length < 3) { setPreview(null); setHint('Drag to draw a closed outline.'); return; }
      if (drawing?.pointsWorld.length) void commitSegmentationStroke(workspaceId, drawing);
    },
    cancel() { stroke.current = null; setPreview(null); getSegmentationSession(workspaceId)?.controller.cancelPreview(); },
  // The stable handler reads fresh presentation state through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [workspaceId, queuePreview, report]);
  useEffect(() => bindSegmentationViewport(workspaceId, pointer), [workspaceId, pointer]);
  useEffect(() => () => pointer.cancel('tool-changed'), [pointer, active?.revision, session?.sliceIndex, session?.tool, session?.activeLabelId, session?.radiusMm, session?.paintOver, frameKey, isFront]);
  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,[contenteditable]'))) panKey.current = true; };
    const up = () => { panKey.current = false; pan.current = null; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up); window.removeEventListener('mouseup', up); };
  }, []);
  const overlay = useCallback((ctx: CanvasRenderingContext2D, at: SliceViewportPlacement) => {
    const live = state.current;
    const tool = session?.tool ?? live?.tool;
    if (!live?.info || !shown || !overlaySlice) return;
    const brush = ready.current && hover && !stroke.current && (tool === 'brush' || tool === 'eraser') ? { ...hover, radiusPx: brushRadiusPx(session?.radiusMm ?? live?.radiusMm ?? 0, shown.plane, at) } : null;
    drawTracingOverlay(ctx, at, { snapshot: live.info.snapshot, sliceIndex: shown.index, plane: shown.plane, slice: overlaySlice, activeLabelId: session?.activeLabelId ?? live.activeLabelId, hiddenLabelIds: session?.hiddenLabelIds ?? live.hiddenLabelIds, preview: ready.current ? preview : null, fill: session?.fill ?? live.fill, hover: brush });
  }, [shown, overlaySlice, preview, session?.activeLabelId, session?.hiddenLabelIds, session?.fill, session?.tool, session?.radiusMm, hover]);
  // Pieces of the active label on this slice (islands beyond the first), for the strip.
  const normalAxis = active?.normalAxis, activeLabelId = session?.activeLabelId;
  const pieces = useMemo(() => slice && normalAxis != null && activeLabelId != null ? labelIslands(labelSliceVoxels(slice.labels, normalAxis), activeLabelId).length + 1 : 1, [slice, normalAxis, activeLabelId]);
  if (!session?.info || !active) return <EmptyPane title="No segmentation session" />;
  const label = active.labels.find((row) => row.definition.id === session.activeLabelId);
  const count = active.dimensions[active.normalAxis];
  const patch = (value: Parameters<typeof setSegmentationPresentation>[1]) => setSegmentationPresentation(workspaceId, value);
  const step = (delta: number) => {
    const next = Math.min(count - 1, Math.max(0, (stepBase.current ?? session.sliceIndex) + delta));
    stepBase.current = next; patch({ sliceIndex: next });
  };
  // A mouse notch (a large delta) is one slice; trackpad deltas add up, one slice per WHEEL_STEP_PX.
  const wheelStep = (dy: number) => {
    if (Math.abs(dy) >= WHEEL_STEP_PX) { wheelRest.current = 0; step(Math.sign(dy)); return; }
    if (Math.sign(wheelRest.current) === -Math.sign(dy)) wheelRest.current = 0;
    wheelRest.current += dy;
    const n = Math.trunc(wheelRest.current / WHEEL_STEP_PX);
    if (n) { wheelRest.current -= n * WHEEL_STEP_PX; step(n); }
  };
  const zoom = (factor: number, anchor: { canvasX: number; canvasY: number }, move?: { dx: number; dy: number }, from = plane) => {
    // Not while a step is pending: the plane on screen belongs to the previous slice.
    if (!from || !placement.current || sliceState?.index !== session.sliceIndex) return;
    const fitPixelMm = slice ? Math.hypot(...slice.plane.u_mm) : Math.hypot(...from.u_mm);
    const result = zoomPanPlane({ plane: from, placement: placement.current, canvas: size, anchor, factor, pan: move, limits: { min: fitPixelMm / 40, max: fitPixelMm * 4 } });
    if (result) { pointer.cancel('tool-changed'); setFraming({ plane: result, index: session.sliceIndex }); }
  };

  const crosshairWorld = workspaceView?.crosshair.world_mm;
  const crosshairPosition = crosshairWorld ? crosshairWorld.map((value, a) => value + active.voxelToWorld[4 * active.normalAxis + a] * (session.sliceIndex - nativeSliceAtWorld(active, crosshairWorld))) as [number, number, number] : null;
  const radiusPx = plane && displayPlacement ? brushRadiusPx(session.radiusMm, plane, displayPlacement) : 0;
  const cursor = cursorWorld && plane && displayPlacement ? projectWorldToCanvas(cursorWorld, plane, displayPlacement) : null;
  // While a stroke is held the browser sends no mouse moves, so follow the stroke's own samples then.
  const drawing = stroke.current !== null;
  const tipAt = !drawing && hover ? { canvasX: hover.x, canvasY: hover.y } : cursor;
  const brushAt = session.tool === 'navigate' ? null : drawing ? (cursor ? { x: cursor.canvasX, y: cursor.canvasY } : null) : hover;
  // A refusal because the active label is locked (not, say, an OS "file is locked" error).
  const lockedRefusal = session.error && label?.locked && /label is locked/i.test(session.error) ? session.error : null;
  const getKnockouts = () => {
    if (!canvas.current || !slice || !plane || !displayPlacement) return [];
    const rect = canvas.current.getBoundingClientRect();
    return tracingClearance(brushAt, radiusPx).map((box) => ({ x: rect.left + box.x * rect.width / size[0], y: rect.top + box.y * rect.height / size[1], width: box.width * rect.width / size[0], height: box.height * rect.height / size[1] }));
  };
  const blocked = preview?.blocked.length ? { reason: 'Stroke constrained', detail: `${preview.written.length} voxels allowed · ${preview.blocked.length} protected. Locks always apply.` } : null;
  const frames = segmentationFrames(active, segmentationFrameCounts(active, loadedLayers));
  return <div className="flex h-full min-h-0 flex-col bg-bf-bg-panel" data-segmentation-session={active.sessionId}>
    <header className="flex flex-wrap items-center gap-2 border-b border-bf-border-subtle px-3 py-1 text-bf-xs">
      <span className="font-medium">Native slice {session.sliceIndex + 1} / {count}</span>
      <IconButton aria-label="Previous native slice" icon={<ChevronLeft />} disabled={session.sliceIndex === 0 || session.busy} onClick={() => step(-1)} />
      <IconButton aria-label="Next native slice" icon={<ChevronRight />} disabled={session.sliceIndex + 1 === count || session.busy} onClick={() => step(1)} />
      <label>Radius <input className="w-14 bg-bf-bg-input font-mono" type="number" inputMode="decimal" min="0.1" max="30" step="0.1" value={radiusDraft && radiusDraft.base === session.radiusMm ? radiusDraft.text : session.radiusMm} {...numericEntryHandlers} onBlur={(event) => { numericEntryHandlers.onBlur?.(event); setRadiusDraft(null); }} onChange={(event) => { const raw = event.target.value, n = Number(raw), valid = raw.trim() !== '' && n >= .1 && n <= 30; setRadiusDraft({ text: raw, base: valid ? n : session.radiusMm }); if (valid) patch({ radiusMm: n }); }} /> mm</label>
      <label>Paint over <select className="bg-bf-bg-input" value={session.paintOver === 'all' ? 'unlocked' : session.paintOver} onChange={(event) => patch({ paintOver: event.target.value as typeof session.paintOver })}><option value="background">Empty space only</option><option value="unlocked">Unlocked labels</option></select></label>
      {active.secondaryVolumeId && active.registration?.status === 'aligned' ? <Button size="sm" onClick={() => setContrast(contrast === 'reference' ? 'secondary' : 'reference')}>{contrast === 'reference' ? 'Show secondary' : 'Show reference'}</Button> : null}
      <Button size="sm" onClick={() => patch({ fill: !session.fill })}>{session.fill ? 'Outline only' : 'Show fills'}</Button>
      <IconButton aria-label="Fit native slice" title="Fit native slice" icon={<Maximize2 />} onClick={() => setFraming(null)} />
    </header>
    <div className="flex min-h-0 flex-1"><TracingTools active={session.tool} disabled={session.busy || !ready.current} onSelect={(tool) => { pointer.cancel('tool-changed'); patch({ tool }); }} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Fixed height, clipped: the strip's text changes during a stroke and must never resize the view (a resize re-frames it and cancels the stroke). */}<div className="h-6 shrink-0 overflow-hidden border-b border-bf-border-subtle px-2 py-1" data-testid="segment-strip-row"><ConstraintStripView label={session.activeLabelId} definition={label ? { name: label.definition.name, color: `rgb(${label.definition.color.join(' ')})` } : undefined} plain paintOver={session.paintOver === 'background' ? 'paints empty space only' : 'paints over unlocked labels'} diameterMm={session.radiusMm * 2} readout={[preview ? `stroke ${preview.written.length} vx` : '', pieces > 1 ? `${pieces} pieces` : ''].filter(Boolean).join(' · ') || undefined} blocked={blocked} /></div>
        <div ref={container} className="relative min-h-0 flex-1 bg-bf-bg-canvas">
          {visible && shown ? <SliceViewport width={size[0]} height={size[1]} context={displayContext} viewPlane={shown.plane} tool={session.tool === 'navigate' ? null : getModuleViewportTool(`segmentation.${session.tool}`)} customRender={overlay} crosshair={crosshairPosition ? { visible: workspaceView?.crosshair.visible ?? true, world_mm: crosshairPosition } : null} crosshairStyle={{ ...crosshairStyle, lineDash: undefined, lineWidth: 1 }} getCrosshairKnockouts={getKnockouts} onWorldClick={(world) => setModuleCrosshair(workspaceId, world)} enableDragDrop={false} onCanvasReady={(element) => { canvas.current = element; }} onPlacementChange={(next) => { placement.current = next; setDisplayPlacement((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next); }}
            onWheel={(event) => { event.preventDefault(); if (event.ctrlKey || event.altKey) { const rect = event.currentTarget.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .005), { canvasX: event.clientX - rect.left, canvasY: event.clientY - rect.top }); } else if (!session.busy) wheelStep(event.deltaY); }}
            onMouseDown={(event) => { if ((event.button === 1 || panKey.current) && plane) { event.preventDefault(); pan.current = { x: event.clientX, y: event.clientY, plane }; } }}
            onMouseMove={(event) => { const box = event.currentTarget.getBoundingClientRect(), image = placement.current; const x = box.width ? (event.clientX - box.left) * size[0] / box.width : NaN, y = box.height ? (event.clientY - box.top) * size[1] / box.height : NaN; setHover(image && x >= image.x && x <= image.x + image.width && y >= image.y && y <= image.y + image.height ? { x, y } : null); if (pan.current) { const rect = event.currentTarget.getBoundingClientRect(); zoom(1, { canvasX: pan.current.x - rect.left, canvasY: pan.current.y - rect.top }, { dx: event.clientX - pan.current.x, dy: event.clientY - pan.current.y }, pan.current.plane); } }} onMouseUp={() => { pan.current = null; }} onMouseLeave={() => { pan.current = null; setHover(null); }} /> : <div role="status" className="p-3 text-bf-xs text-bf-text-muted">Preparing the reference plane…</div>}
          {ready.current && tipAt && (blocked || lockedRefusal || hint) ? <div role="status" className="pointer-events-none absolute max-w-[240px] border border-bf-border-subtle bg-bf-bg-panel px-2 py-1 text-bf-xs shadow-sm" style={{ left: Math.max(4, Math.min(size[0] - 244, tipAt.canvasX + 14)), top: Math.max(4, Math.min(size[1] - 64, tipAt.canvasY + 14)) }}>{hint?.text ?? lockedRefusal ?? `${preview!.blocked.length} voxels protected: ${preview!.blockedLabels.map((id) => active.labels.find((row) => row.definition.id === id)?.definition.name ?? 'constraint').join(', ')}`}</div> : null}
          {displayError || session.error ? <div role="alert" className="absolute bottom-3 left-3 right-3 border border-bf-border-subtle bg-bf-bg-panel p-2 text-bf-xs">{displayError ?? session.error}{!displayError && lockedRefusal && label ? <Button size="sm" disabled={session.busy} onClick={() => void setSegmentationLabelState(workspaceId, label.definition.id, false, label.complete)}>Unlock {label.definition.name}</Button> : <Button size="sm" onClick={() => { setDisplayError(null); setAttempt((n) => n + 1); void reconcileSegmentationSession(workspaceId); }}>Retry session</Button>}</div> : null}
        </div>
      </div>
      <NativeSliceRuler snapshot={active} activeId={session.activeLabelId} current={session.sliceIndex} onPick={(sliceIndex) => { if (!session.busy) patch({ sliceIndex }); }} />
      {layerReady ? <ContextViews workspaceId={workspaceId} snapshot={active} referenceVolumeId={session.info.referenceDisplayVolumeId} labelVolumeId={session.info.labelVolumeId} sliceIndex={session.sliceIndex} activeLabelId={session.activeLabelId} activeHidden={session.hiddenLabelIds.includes(session.activeLabelId)} /> : null}
    </div>
    <footer className="border-t border-bf-border-subtle px-3 py-1 font-mono text-bf-2xs text-bf-text-muted">{active.identity.subject} · {active.identity.hemisphere} · {active.identity.rater} · revision {active.revision} · {segmentationSaveState(session)}{frames ? ` · ${frames}` : ''}{active.sourceHeaderOriginal ? '' : ' · derived grid: no original NIfTI header'} · ⌥/pinch zoom · Space-drag pan</footer>
  </div>;
}
