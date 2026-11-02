import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SegmentationSnapshot } from '@brainflow/api';
import { SliceViewport, captureActiveWorkspace, formatModuleError } from '@/modules/api/host';
import { edgeBoxFromAffine, fitPlaneToWorldBox, renderModulePlane, setModuleCrosshair, useWorkspaceRenderState, type RenderContext } from '@/modules/api/rendering';
import { setSegmentationPresentation } from '@/modules/segmentation/session';
import { nativeSliceAtWorld, voxelWorld } from './shared/TracingOverlay';

type Axis = 'axial' | 'coronal' | 'sagittal';
const names = ['sagittal', 'coronal', 'axial'] as const;
export function ContextViews({ workspaceId, snapshot, labelVolumeId, sliceIndex }: { workspaceId: string; snapshot: SegmentationSnapshot; labelVolumeId: string; sliceIndex: number }) {
  const normal = snapshot.normalAxis;
  const vector = [0, 1, 2].map((a) => snapshot.voxelToWorld[normal * 4 + a]);
  const dominant = vector.reduce((best, v, a) => Math.abs(v) > Math.abs(vector[best]) ? a : best, 0);
  return <aside className="flex w-[220px] min-w-[160px] max-w-[28%] shrink-0 flex-col border-l border-bf-border-subtle" aria-label="World-frame context views">
    {names.filter((_, index) => index !== dominant).map((axis) => <ContextTile key={axis} {...{ workspaceId, snapshot, labelVolumeId, sliceIndex, axis }} />)}
  </aside>;
}
function ContextTile({ workspaceId, snapshot, labelVolumeId, sliceIndex, axis }: { workspaceId: string; snapshot: SegmentationSnapshot; labelVolumeId: string; sliceIndex: number; axis: Axis }) {
  const target = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([220, 220]);
  const [error, setError] = useState<string | null>(null);
  const state = useWorkspaceRenderState(workspaceId);
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
  const context = useMemo<RenderContext>(() => ({ id: `segmentation-${workspaceId}-${axis}`, type: 'slice', dimensions: { width: size[0], height: size[1] }, metadata: { workspaceId }, viewPlane: plane ?? undefined }), [workspaceId, axis, size, plane]);
  useEffect(() => {
    if (!target.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) { const next: [number, number] = [Math.max(1, Math.round(entry.contentRect.width)), Math.max(1, Math.round(entry.contentRect.height))]; setSize((old) => old[0] === next[0] && old[1] === next[1] ? old : next); } });
    observer.observe(target.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!plane) return;
    let disposed = false; const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent();
    void renderModulePlane({ workspaceId, context, plane, volumeIds: [snapshot.referenceVolumeId, labelVolumeId], isCurrent: current }).catch((failure) => { if (current()) setError(formatModuleError(failure)); });
    return () => { disposed = true; };
  }, [workspaceId, context, plane, snapshot.referenceVolumeId, snapshot.revision, labelVolumeId, state?.layers]);
  return <section className="flex min-h-0 flex-1 flex-col border-b border-bf-border-subtle">
    <header className="px-2 py-1 text-bf-2xs text-bf-text-muted">{axis[0].toUpperCase() + axis.slice(1)} · world-frame reslice</header>
    <div ref={target} className="relative min-h-0 flex-1 bg-bf-bg-canvas">{plane ? <SliceViewport context={context} viewPlane={plane} width={size[0]} height={size[1]} crosshair={{ visible: true, world_mm: world }} onWorldClick={(position) => { setModuleCrosshair(workspaceId, position); setSegmentationPresentation(workspaceId, { sliceIndex: Math.max(0, Math.min(snapshot.dimensions[snapshot.normalAxis] - 1, Math.round(nativeSliceAtWorld(snapshot, position)))) }); }} /> : null}{error ? <p role="status" className="absolute bottom-1 left-1 text-bf-2xs text-bf-warning">{error}</p> : null}</div>
  </section>;
}
