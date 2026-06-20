/**
 * HybridOrthoSurfaceWorkspace
 *
 * A combined surface/volume view: a row of orthogonal slices (axial, sagittal,
 * coronal) on top, a 3D surface view below. Both render the same activation-map
 * layers — the slices sample the overlay volume directly, the surface shows the
 * volume projected onto the cortex — kept in sync by the activation-map binding.
 *
 * Either region can be maximized to fill the whole panel (and restored) via the
 * chrome buttons. Maximize collapses the other Allotment pane rather than
 * unmounting it, so the GPU/WebGL contexts and view state survive the toggle.
 */

import { useCallback, useMemo, useState } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { Maximize2, Minimize2, Workflow, Loader2 } from 'lucide-react';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { SurfaceViewPanel } from './SurfaceViewPanel';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useActivationMapBinding } from '@/hooks/useActivationMapBinding';
import { useVolToSurfProjection } from '@/hooks/useVolToSurfProjection';

type MaximizedRegion = 'none' | 'slices' | 'surface';

/** Floating maximize/restore button shared by both regions. */
function MaximizeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? `Restore ${label}` : `Maximize ${label}`}
      aria-label={active ? `Restore ${label}` : `Maximize ${label}`}
      className="pointer-events-auto rounded p-1 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
    >
      {active ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function HybridOrthoSurfaceWorkspace() {
  const [maximized, setMaximized] = useState<MaximizedRegion>('none');

  // Mirror volume display props onto projected surface overlays while mounted.
  useActivationMapBinding();

  const activeSurfaceId = useSurfaceStore((state) => state.activeSurfaceId);
  const surfaceIds = useSurfaceStore((state) => Array.from(state.surfaces.keys()));

  const { canProject, volumeIds, projectVolume, isProjecting } = useVolToSurfProjection();

  const projectionTarget = useMemo(() => {
    const volumeId = volumeIds[0];
    const surfaceId = activeSurfaceId ?? surfaceIds[0];
    return volumeId && surfaceId ? { volumeId, surfaceId } : null;
  }, [volumeIds, activeSurfaceId, surfaceIds]);

  const toggle = useCallback(
    (region: Exclude<MaximizedRegion, 'none'>) =>
      setMaximized((current) => (current === region ? 'none' : region)),
    []
  );

  const handleProject = useCallback(() => {
    if (!projectionTarget) return;
    void projectVolume(
      projectionTarget.volumeId,
      projectionTarget.surfaceId,
      'Activation (projected)',
      // GPU path ships the volume + affine to the surface shader via the
      // get_volume_for_projection backend command.
      { useGPUProjection: true }
    );
  }, [projectVolume, projectionTarget]);

  const canRunProjection = canProject && !!projectionTarget && !isProjecting;

  return (
    <div className="relative h-full w-full bg-black">
      <Allotment vertical defaultSizes={[40, 60]}>
        {/* Top: orthogonal slice row */}
        <Allotment.Pane minSize={120} visible={maximized !== 'surface'}>
          <div className="relative h-full w-full">
            <Allotment defaultSizes={[1, 1, 1]}>
              <Allotment.Pane minSize={120}>
                <FlexibleSlicePanel viewId="axial" title="Axial" />
              </Allotment.Pane>
              <Allotment.Pane minSize={120}>
                <FlexibleSlicePanel viewId="sagittal" title="Sagittal" />
              </Allotment.Pane>
              <Allotment.Pane minSize={120}>
                <FlexibleSlicePanel viewId="coronal" title="Coronal" />
              </Allotment.Pane>
            </Allotment>

            {/* Region chrome (absolute so it never resizes the slice canvases). */}
            <div className="pointer-events-none absolute right-1.5 top-1.5 z-30 flex items-center gap-1">
              <MaximizeButton
                active={maximized === 'slices'}
                onClick={() => toggle('slices')}
                label="slices"
              />
            </div>
          </div>
        </Allotment.Pane>

        {/* Bottom: 3D surface view */}
        <Allotment.Pane minSize={160} visible={maximized !== 'slices'}>
          <div className="relative h-full w-full">
            <SurfaceViewPanel />

            <div className="pointer-events-none absolute right-1.5 top-1.5 z-30 flex items-center gap-1">
              <button
                type="button"
                onClick={handleProject}
                disabled={!canRunProjection}
                title={
                  canRunProjection
                    ? 'Project the active overlay volume onto this surface'
                    : 'Load a volume overlay and a surface to project'
                }
                aria-label="Project volume onto surface"
                className="pointer-events-auto flex items-center gap-1 rounded px-1.5 py-1 text-[10px] uppercase tracking-wider text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isProjecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Workflow className="h-3.5 w-3.5" />
                )}
                <span>Project</span>
              </button>
              <MaximizeButton
                active={maximized === 'surface'}
                onClick={() => toggle('surface')}
                label="surface"
              />
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
