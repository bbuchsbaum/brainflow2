import { projectWorldToCanvas } from '@brainflow/visualization/slice';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SegmentationPreview, SegmentationSlice, SegmentationStroke } from '@brainflow/api';
import { Button, EmptyPane, IconButton } from '@/components/ui/bf';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { SliceViewport, captureActiveWorkspace, useActiveWorkspaceId, getModuleViewportTool, formatModuleError, isLiveDocument, isDocumentEditingFrozen, removeModuleLayers, useLoadedVolumeLayers, useModuleCrosshairStyle, type ViewportPointerSample, type ViewportTool } from '@/modules/api/host';
import { ensureModuleImageLayer, ensureModuleLabelLayer, renderModulePlane, resizeZoomedPlane, setModuleCrosshair, useWorkspaceRenderState, zoomPanPlane, type RenderContext, type SliceViewportPlacement, type ViewPlane } from '@/modules/api/rendering';
import { commitSegmentationStroke, getSegmentationSession, reconcileSegmentationSession, setSegmentationLabelState, segmentationFrameCounts, segmentationFrames, segmentationSaveState, setSegmentationPresentation, useSegmentationSession } from '@/modules/segmentation/session';
import { bindSegmentationViewport } from '@/modules/segmentation/toolBindings';
import { drawTracingOverlay, nativeSliceAtWorld, tracingClearance } from '@/modules/segmentation/components/shared/TracingOverlay';
import { ConstraintStripView } from '@/modules/segmentation/components/shared/ConstraintStripView';
import { TracingTools } from '@/modules/segmentation/components/shared/TracingTools';
import { ContextViews } from './ContextViews';
import { NativeSliceRuler } from '@/modules/segmentation/components/shared/SliceProgress';
import { numericEntryHandlers } from '@/modules/segmentation/components/shared/numericEntry';

const viewPlane = (slice: SegmentationSlice): ViewPlane => ({ ...slice.plane, dim_px: [slice.plane.width_px, slice.plane.height_px] });
const text = formatModuleError;
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
  const [slice, setSlice] = useState<SegmentationSlice | null>(null);
  const [preview, setPreview] = useState<SegmentationPreview | null>(null);
  const [cursorWorld, setCursorWorld] = useState<[number, number, number] | null>(null);
  const [framing, setFraming] = useState<{ plane: ViewPlane; index: number } | null>(null);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [layerReady, setLayerReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [contrast, setContrast] = useState<'reference' | 'secondary'>('reference');
  const [renderedFrame, setRenderedFrame] = useState('');
  // The radius as typed: may be empty or out of range while retyping; only valid values apply.
  const [radiusDraft, setRadiusDraft] = useState<string | null>(null);
  const ready = useRef(false);
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
    if (!slice || !active) return null;
    if (!framing) return viewPlane(slice);
    const resized = resizeZoomedPlane(framing.plane, size);
    const offset = session.sliceIndex - framing.index;
    return { ...resized, origin_mm: resized.origin_mm.map((v, axis) => v + active.voxelToWorld[4 * active.normalAxis + axis] * offset) as [number, number, number] };
  }, [slice, active, framing, size, session?.sliceIndex]);
  const stablePlane = useRef<ViewPlane | null>(null);
  if (JSON.stringify(stablePlane.current) !== JSON.stringify(candidatePlane)) stablePlane.current = candidatePlane;
  const plane = stablePlane.current;
  const sourceId = contrast === 'secondary' && active?.registration?.status === 'aligned' ? secondaryDisplayId ?? referenceDisplayId : referenceDisplayId;
  const frameKey = JSON.stringify([plane, sourceId]);
  ready.current = Boolean(isFront && session && slice && slice.revision === active?.revision && layerReady && renderedFrame === frameKey && !displayError && !session.info?.renderError);
  const context = useMemo<RenderContext>(() => ({ id: `segmentation-${workspaceId}-primary`, type: 'slice', dimensions: { width: size[0], height: size[1] }, metadata: { workspaceId }, viewPlane: plane ?? undefined }), [workspaceId, size, plane]);
  const report = useCallback((error: unknown) => setSegmentationPresentation(workspaceId, { error: text(error) }), [workspaceId]);

  useEffect(() => {
    const target = container.current; if (!target) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) { const width = Math.max(1, Math.round(entry.contentRect.width)), height = Math.max(1, Math.round(entry.contentRect.height)); setSize((old) => old[0] === width && old[1] === height ? old : [width, height]); }
    });
    observer.observe(target); return () => observer.disconnect();
  }, []);
  useEffect(() => { void reconcileSegmentationSession(workspaceId); }, [workspaceId]);
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
    let disposed = false;
    setSlice(null); setPreview(null);
    void record.controller.slice(session?.sliceIndex ?? 0, size).then((result) => { if (!disposed && result) setSlice(result); }).catch((error) => { if (!disposed) report(error); });
    return () => { disposed = true; record.controller.cancelPreview(); };
  }, [workspaceId, active?.sessionId, active?.revision, session?.sliceIndex, size, report, isFront]);
  useEffect(() => {
    if (!isFront || !plane || !sourceId || !layerReady) return;
    let disposed = false;
    const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent();
    void renderModulePlane({ workspaceId, context, plane, volumeIds: [sourceId], isCurrent: current }).then(() => { if (current()) setRenderedFrame(frameKey); }).catch((error) => { if (current()) setDisplayError(text(error)); });
    return () => { disposed = true; };
  }, [workspaceId, plane, context, sourceId, frameKey, workspaceView?.layers, layerReady, attempt, isFront]);

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
      if (!sample.world) { stroke.current = null; setPreview(null); report('Stroke cancelled outside the reference image.'); return; }
      if (drawing.pointsWorld.length >= 4096) { stroke.current = null; report('Stroke is too long. Use several shorter strokes.'); return; }
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
      stroke.current = { labelId: live.activeLabelId, sliceIndex: live.sliceIndex, tool: live.tool, radiusMm: live.radiusMm, paintOver: live.paintOver, pointsWorld: [] };
      append(samples); queuePreview(); return true;
    },
    pointerMove(samples) { if (!ready.current) { stroke.current = null; setPreview(null); return; } append(samples); queuePreview(); },
    pointerUp(samples) {
      if (!ready.current) { stroke.current = null; setPreview(null); getSegmentationSession(workspaceId)?.controller.cancelPreview(); return; }
      append(samples);
      const drawing = stroke.current; stroke.current = null;
      getSegmentationSession(workspaceId)?.controller.cancelPreview();
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
    if (ready.current && live?.info && slice && plane) drawTracingOverlay(ctx, at, { snapshot: live.info.snapshot, sliceIndex: live.sliceIndex, plane, slice, activeLabelId: session?.activeLabelId ?? live.activeLabelId, hiddenLabelIds: session?.hiddenLabelIds ?? live.hiddenLabelIds, preview, fill: session?.fill ?? live.fill });
  }, [slice, plane, preview, session?.activeLabelId, session?.hiddenLabelIds, session?.fill]);
  if (!session?.info || !active) return <EmptyPane title="No segmentation session" />;
  const label = active.labels.find((row) => row.definition.id === session.activeLabelId);
  const count = active.dimensions[active.normalAxis];
  const patch = (value: Parameters<typeof setSegmentationPresentation>[1]) => setSegmentationPresentation(workspaceId, value);
  const step = (delta: number) => patch({ sliceIndex: Math.min(count - 1, Math.max(0, session.sliceIndex + delta)) });
  const zoom = (factor: number, anchor: { canvasX: number; canvasY: number }, move?: { dx: number; dy: number }, from = plane) => {
    if (!from || !placement.current) return;
    const fitPixelMm = slice ? Math.hypot(...slice.plane.u_mm) : Math.hypot(...from.u_mm);
    const result = zoomPanPlane({ plane: from, placement: placement.current, canvas: size, anchor, factor, pan: move, limits: { min: fitPixelMm / 40, max: fitPixelMm * 4 } });
    if (result) { pointer.cancel('tool-changed'); setFraming({ plane: result, index: session.sliceIndex }); }
  };

  const crosshairWorld = workspaceView?.crosshair.world_mm;
  const crosshairPosition = crosshairWorld ? crosshairWorld.map((value, a) => value + active.voxelToWorld[4 * active.normalAxis + a] * (session.sliceIndex - nativeSliceAtWorld(active, crosshairWorld))) as [number, number, number] : null;
  const brushGap = plane && displayPlacement && session.tool !== 'navigate' ? 3 * session.radiusMm / Math.hypot(...plane.u_mm) * displayPlacement.width / displayPlacement.imageWidth : 0;
  const cursor = cursorWorld && plane && displayPlacement ? projectWorldToCanvas(cursorWorld, plane, displayPlacement) : null;
  const lockedRefusal = session.error?.toLowerCase().includes('locked') ? session.error : null;
  const getKnockouts = () => {
    if (!canvas.current || !slice || !plane || !displayPlacement) return [];
    const rect = canvas.current.getBoundingClientRect();
    return tracingClearance(active, slice, session.sliceIndex, plane, displayPlacement, session.tool === 'navigate' ? null : cursorWorld, session.radiusMm).map((box) => ({ x: rect.left + box.x * rect.width / size[0], y: rect.top + box.y * rect.height / size[1], width: box.width * rect.width / size[0], height: box.height * rect.height / size[1] }));
  };
  const blocked = preview?.blocked.length ? { reason: 'Stroke constrained', detail: `${preview.written.length} voxels allowed · ${preview.blocked.length} protected. Locks always apply.` } : null;
  const frames = segmentationFrames(active, segmentationFrameCounts(active, loadedLayers));
  return <div className="flex h-full min-h-0 flex-col bg-bf-bg-panel" data-segmentation-session={active.sessionId}>
    <header className="flex flex-wrap items-center gap-2 border-b border-bf-border-subtle px-3 py-1 text-bf-xs">
      <span className="font-medium">Native slice {session.sliceIndex + 1} / {count}</span>
      <IconButton aria-label="Previous native slice" icon={<ChevronLeft />} disabled={session.sliceIndex === 0 || session.busy} onClick={() => step(-1)} />
      <IconButton aria-label="Next native slice" icon={<ChevronRight />} disabled={session.sliceIndex + 1 === count || session.busy} onClick={() => step(1)} />
      <label>Radius <input className="w-14 bg-bf-bg-input font-mono" type="number" inputMode="decimal" min="0.1" max="30" step="0.1" value={radiusDraft ?? session.radiusMm} {...numericEntryHandlers} onBlur={(event) => { numericEntryHandlers.onBlur?.(event); setRadiusDraft(null); }} onChange={(event) => { const raw = event.target.value, n = Number(raw); setRadiusDraft(raw); if (raw.trim() !== '' && n >= .1 && n <= 30) patch({ radiusMm: n }); }} /> mm</label>
      <label>Paint <select className="bg-bf-bg-input" value={session.paintOver} onChange={(event) => patch({ paintOver: event.target.value as typeof session.paintOver })}><option value="background">Background only</option><option value="unlocked">Unlocked labels</option><option value="all">All unlocked labels</option></select></label>
      {active.secondaryVolumeId && active.registration?.status === 'aligned' ? <Button size="sm" onClick={() => setContrast(contrast === 'reference' ? 'secondary' : 'reference')}>{contrast === 'reference' ? 'Show secondary' : 'Show reference'}</Button> : null}
      <Button size="sm" onClick={() => patch({ fill: !session.fill })}>{session.fill ? 'Outline only' : 'Show fills'}</Button>
      <IconButton aria-label="Fit native slice" title="Fit native slice" icon={<Maximize2 />} onClick={() => setFraming(null)} />
    </header>
    <div className="flex min-h-0 flex-1"><TracingTools active={session.tool} disabled={session.busy || !ready.current} onSelect={(tool) => { pointer.cancel('tool-changed'); patch({ tool }); }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-6 overflow-auto border-b border-bf-border-subtle px-2 py-1"><ConstraintStripView label={session.activeLabelId} definition={label ? { name: label.definition.name, color: `rgb(${label.definition.color.join(' ')})` } : undefined} paintOver={session.paintOver === 'background' ? 'background only' : 'over unlocked'} diameterMm={session.radiusMm * 2} readout={preview ? `${preview.written.length} vx · one native slice` : 'one native slice'} blocked={blocked} /></div>
        <div ref={container} className="relative min-h-0 flex-1 bg-bf-bg-canvas">
          {ready.current && plane && slice ? <SliceViewport width={size[0]} height={size[1]} context={context} viewPlane={plane} tool={session.tool === 'navigate' ? null : getModuleViewportTool(`segmentation.${session.tool}`)} customRender={overlay} crosshair={crosshairPosition ? { visible: workspaceView?.crosshair.visible ?? true, world_mm: crosshairPosition } : null} crosshairStyle={{ ...crosshairStyle, centerGap: Math.max(crosshairStyle.centerGap ?? 0, brushGap) }} getCrosshairKnockouts={getKnockouts} onWorldClick={(world) => setModuleCrosshair(workspaceId, world)} enableDragDrop={false} onCanvasReady={(element) => { canvas.current = element; }} onPlacementChange={(next) => { placement.current = next; setDisplayPlacement((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next); }}
            onWheel={(event) => { event.preventDefault(); if (event.ctrlKey || event.altKey) { const rect = event.currentTarget.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .005), { canvasX: event.clientX - rect.left, canvasY: event.clientY - rect.top }); } else if (!session.busy) step(event.deltaY > 0 ? 1 : -1); }}
            onMouseDown={(event) => { if ((event.button === 1 || panKey.current) && plane) { event.preventDefault(); pan.current = { x: event.clientX, y: event.clientY, plane }; } }}
            onMouseMove={(event) => { if (pan.current) { const rect = event.currentTarget.getBoundingClientRect(); zoom(1, { canvasX: pan.current.x - rect.left, canvasY: pan.current.y - rect.top }, { dx: event.clientX - pan.current.x, dy: event.clientY - pan.current.y }, pan.current.plane); } }} onMouseUp={() => { pan.current = null; }} onMouseLeave={() => { pan.current = null; }} /> : <div role="status" className="p-3 text-bf-xs text-bf-text-muted">Preparing the reference plane…</div>}
          {ready.current && cursor && (blocked || lockedRefusal) ? <div role="status" className="pointer-events-none absolute max-w-[240px] border border-bf-border-subtle bg-bf-bg-panel px-2 py-1 text-bf-xs shadow-sm" style={{ left: Math.max(4, Math.min(size[0] - 244, cursor.canvasX + 14)), top: Math.max(4, Math.min(size[1] - 64, cursor.canvasY + 14)) }}>{lockedRefusal ?? `${preview!.blocked.length} voxels protected: ${preview!.blockedLabels.map((id) => active.labels.find((row) => row.definition.id === id)?.definition.name ?? 'constraint').join(', ')}`}</div> : null}
          {displayError || session.error ? <div role="alert" className="absolute bottom-3 left-3 right-3 border border-bf-border-subtle bg-bf-bg-panel p-2 text-bf-xs">{displayError ?? session.error}{!displayError && lockedRefusal ? (label?.locked ? <Button size="sm" disabled={session.busy} onClick={() => void setSegmentationLabelState(workspaceId, label.definition.id, false, label.complete)}>Unlock {label.definition.name}</Button> : null) : <Button size="sm" onClick={() => { setDisplayError(null); setAttempt((n) => n + 1); void reconcileSegmentationSession(workspaceId); }}>Retry session</Button>}</div> : null}
        </div>
      </div>
      <NativeSliceRuler snapshot={active} activeId={session.activeLabelId} current={session.sliceIndex} onPick={(sliceIndex) => { if (!session.busy) patch({ sliceIndex }); }} />
      {layerReady ? <ContextViews workspaceId={workspaceId} snapshot={active} referenceVolumeId={session.info.referenceDisplayVolumeId} labelVolumeId={session.info.labelVolumeId} sliceIndex={session.sliceIndex} activeLabelId={session.activeLabelId} activeHidden={session.hiddenLabelIds.includes(session.activeLabelId)} /> : null}
    </div>
    <footer className="border-t border-bf-border-subtle px-3 py-1 font-mono text-bf-2xs text-bf-text-muted">{active.identity.subject} · {active.identity.hemisphere} · {active.identity.rater} · revision {active.revision} · {segmentationSaveState(session)}{frames ? ` · ${frames}` : ''}{active.sourceHeaderOriginal ? '' : ' · derived grid: no original NIfTI header'} · ⌥/pinch zoom · Space-drag pan</footer>
  </div>;
}
