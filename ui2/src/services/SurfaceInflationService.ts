/**
 * Computed inflated meshes for folded surfaces whose set has no inflated one
 * (TemplateFlow fsaverage). The work is spread over tasks so the UI keeps
 * responding (~0.5–1 s for a 164k-vertex hemisphere), the result is stored on
 * the source mesh (`computedVariants.inflated`) and its family draws it as
 * one more geometry.
 */
import { inflateSurfaceSteps } from '@brainflow/visualization/surface';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { addLogEntry } from '@/stores/logStore';

export const COMPUTED_INFLATED = 'inflated';

export class SurfaceInflationService {
  private inFlight = new Map<string, Promise<boolean>>();

  /** Inflate `handle`'s mesh unless done or running. Resolves true when it has one. */
  ensureInflated(handle: string): Promise<boolean> {
    const surface = useSurfaceStore.getState().surfaces.get(handle);
    if (!surface || surface.geometry.vertices.length === 0) return Promise.resolve(false);
    if (surface.computedVariants?.[COMPUTED_INFLATED]) return Promise.resolve(true);
    const running = this.inFlight.get(handle);
    if (running) return running;
    const job = this.run(handle).finally(() => this.inFlight.delete(handle));
    this.inFlight.set(handle, job);
    return job;
  }

  private async run(handle: string): Promise<boolean> {
    const surface = useSurfaceStore.getState().surfaces.get(handle)!;
    const { vertices, faces } = surface.geometry;
    const started = performance.now();
    try {
      const steps = inflateSurfaceSteps(vertices, faces);
      let result: Float32Array | null = null;
      while (!result) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        // The mesh was unloaded or replaced meanwhile: drop the work.
        if (useSurfaceStore.getState().surfaces.get(handle)?.geometry.vertices !== vertices) {
          return false;
        }
        const step = steps.next();
        if (step.done) result = step.value;
      }
      useSurfaceStore.getState().setSurfaceComputedVariant(handle, COMPUTED_INFLATED, result);
      addLogEntry({
        level: 'info',
        source: 'surface',
        message: `Computed an inflated surface for ${surface.name} (${Math.round(performance.now() - started)} ms)`,
      });
      return true;
    } catch (error) {
      addLogEntry({
        level: 'warn',
        source: 'surface',
        message: `Could not compute an inflated surface for ${surface.name}: ${String(error)}`,
      });
      return false;
    }
  }
}

let instance: SurfaceInflationService | null = null;
export function getSurfaceInflationService(): SurfaceInflationService {
  instance ??= new SurfaceInflationService();
  return instance;
}
