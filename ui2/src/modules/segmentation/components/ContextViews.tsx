import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SegmentationSnapshot } from '@brainflow/api';
import { SliceViewport, captureActiveWorkspace, formatModuleError, useActiveWorkspaceId, useModuleCrosshairStyle } from '@/modules/api/host';
import { edgeBoxFromAffine, fitPlaneToWorldBox, renderModulePlane, setModuleCrosshair, useWorkspaceRenderState, type RenderContext } from '@/modules/api/rendering';
import { setSegmentationPresentation } from '@/modules/segmentation/session';
import { nativeSliceAtWorld, voxelWorld } from './shared/TracingOverlay';

type Axis = 'axial' | 'coronal' | 'sagittal';
interface ContextProps { workspaceId: string; snapshot: SegmentationSnapshot; referenceVolumeId: string; labelVolumeId: string; sliceIndex: number; activeLabelId: number; activeHidden: boolean; }
const names = ['sagittal', 'coronal', 'axial'] as const;
export function ContextViews({ workspaceId, snapshot, referenceVolumeId, labelVolumeId, sliceIndex, activeLabelId, activeHidden }: ContextProps) {
  const normal = snapshot.normalAxis;
  const vector = [0, 1, 2].map((a) => snapshot.voxelToWorld[normal * 4 + a]);
  const dominant = vector.reduce((best, v, a) => Math.abs(v) > Math.abs(vector[best]) ? a : best, 0);
  return <aside className="flex w-[220px] min-w-[160px] max-w-[28%] shrink-0 flex-col border-l border-bf-border-subtle" aria-label="World-frame context views">
    {names.filter((_, index) => index !== dominant).map((axis) => <ContextTile key={axis} {...{ workspaceId, snapshot, referenceVolumeId, labelVolumeId, sliceIndex, activeLabelId, activeHidden, axis }} />)}
  </aside>;
}
function ContextTile({ workspaceId, snapshot, referenceVolumeId, labelVolumeId, sliceIndex, activeLabelId, activeHidden, axis }: ContextProps & { axis: Axis }) {
  const target = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const crosshairStyle = useModuleCrosshairStyle();
  const [size, setSize] = useState<[number, number]>([220, 220]);
  const [error, setError] = useState<string | null>(null);
  const state = useWorkspaceRenderState(workspaceId);
  const isFront = useActiveWorkspaceId() === workspaceId;
  const [renderedFrame, setRenderedFrame] = useState('');
  const box = useMemo(() => edgeBoxFromAffine(snapshot.voxelToWorld, snapshot.dimensions), [snapshot.voxelToWorld, snapshot.dimensions]);
  const world = useMemo(() => {
    if (state?.crosshair.world_mm) {
      const current = state.crosshair.world_mm;
      const offset = sliceIndex - nativeSliceAtWorld(snapshot, current);
      return current.map((v, a) => v + snapshot.voxelToWorld[4 * snapshot.normalAxis + a] * offset) as [number, number, number];
    }
    const voxel = snapshot.dimensions.map((n) => (n - 1) / 2); voxel[snapshot.normalAxis] = sliceIndex;
    return voxelWorld(snapshot.voxelToWorld, voxel);
  }, [snapshot, sliceIndex, state?.crosshair.world_mm]);
  const plane = useMemo(() => box ? fitPlaneToWorldBox(axis, box, world, size, state?.views[axis]) : null, [axis, box, world, size, state?.views]);
  const frameKey = JSON.stringify([plane, snapshot.revision, activeLabelId, activeHidden]);
  const context = useMemo<RenderContext>(() => ({ id: `segmentation-${workspaceId}-${axis}`, type: 'slice', dimensions: { width: size[0], height: size[1] }, metadata: { workspaceId }, viewPlane: plane ?? undefined }), [workspaceId, axis, size, plane]);
  useEffect(() => {
    if (!target.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) { const next: [number, number] = [Math.max(1, Math.round(entry.contentRect.width)), Math.max(1, Math.round(entry.contentRect.height))]; setSize((old) => old[0] === next[0] && old[1] === next[1] ? old : next); } });
    observer.observe(target.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!isFront || !plane) return;
    setRenderedFrame(''); setError(null);
    let disposed = false; const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent();
    void renderModulePlane({ workspaceId, context, plane, volumeIds: [referenceVolumeId, labelVolumeId], layerOverrides: { [labelVolumeId]: { visible: !activeHidden, opacity: 1, labelDisplay: 'outline', outline: { enabled: true, selectedLabelId: activeLabelId, color: [1, 1, 1, 1], colorMode: 'lut', thicknessPx: 1, haloPx: .75, haloColor: [0, 0, 0, .85] } } }, isCurrent: current }).then(() => { if (current()) setRenderedFrame(frameKey); }).catch((failure) => { if (current()) setError(formatModuleError(failure)); });
    return () => { disposed = true; };
  }, [workspaceId, context, plane, referenceVolumeId, snapshot.revision, labelVolumeId, activeLabelId, activeHidden, state?.layers, isFront, frameKey]);
  return <section className="flex min-h-0 flex-1 flex-col border-b border-bf-border-subtle">
    <header className="px-2 py-1 text-bf-2xs text-bf-text-muted">{axis[0].toUpperCase() + axis.slice(1)} · world-frame reslice · active label</header>
    <div ref={target} className="relative min-h-0 flex-1 bg-bf-bg-canvas">{isFront && renderedFrame === frameKey && plane ? <SliceViewport context={context} viewPlane={plane} width={size[0]} height={size[1]} crosshair={{ visible: true, world_mm: world }} crosshairStyle={crosshairStyle} onCanvasReady={(element) => { canvas.current = element; }} getCrosshairKnockouts={() => { const r = canvas.current?.getBoundingClientRect(); return r ? [{ x: r.left + 8, y: r.top + 8, width: Math.max(0, r.width - 16), height: Math.max(0, r.height - 16) }] : []; }} onWorldClick={(position) => { setModuleCrosshair(workspaceId, position); setSegmentationPresentation(workspaceId, { sliceIndex: Math.max(0, Math.min(snapshot.dimensions[snapshot.normalAxis] - 1, Math.round(nativeSliceAtWorld(snapshot, position)))) }); }} /> : null}{error ? <p role="status" className="absolute bottom-1 left-1 text-bf-2xs text-bf-warning">{error}</p> : null}</div>
  </section>;
}
