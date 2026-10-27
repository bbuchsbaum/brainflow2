/**
 * SurfaceCurvatureService (phase 4, D2): the grey folding underlay for each
 * loaded surface.
 *
 * Order of sources, per surface:
 * 1. a `sulc` / `curv` file next to the mesh (found by listing its folder;
 *    FreeSurfer binary through tauri-plugin-fs, GIfTI through the overlay
 *    loader), when its length matches the vertex count;
 * 2. sulcal depth computed from the matching FOLDED mesh (white, pial,
 *    midthickness: the mesh itself when it is folded, else a loaded one of
 *    the same subject, hemisphere and topology; surfaceLink);
 * 3. none: the plain base colour.
 * A surface is (re)examined when it is loaded and whenever a matching folded
 * mesh appears. Values are attached with surfaceStore.setSurfaceCurvature.
 */
import { computeSurfaceSulcalDepth } from '@brainflow/visualization/surface';
import { getTransport } from './transport';
import { FilesystemService } from './filesystem/FilesystemService';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { anatomicalMeshesFor } from '@/components/views/surfaceLink';
import { curvatureSidecarCandidates, parseFreeSurferCurv } from '@/utils/surfaceCurvatureFiles';

export const READ_FILE_COMMAND = 'plugin:fs|read_file';

/** The bytes of an IPC answer; a typed-array view keeps its own window of the buffer (review n5). */
export function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (Object.prototype.toString.call(raw) === '[object ArrayBuffer]')
    return new Uint8Array(raw as ArrayBuffer);
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  return null;
}

export class SurfaceCurvatureService {
  private unsubscribe: (() => void) | null = null;
  /** handle -> key of the inputs last examined (so a new folded mesh re-runs). */
  private examined = new Map<string, string>();
  private inFlight = new Set<string>();

  /** Watch the surface store (idempotent). */
  start(): void {
    if (this.unsubscribe) return;
    this.examineAll();
    this.unsubscribe = useSurfaceStore.subscribe((state, prev) => {
      if (state.surfaces !== prev.surfaces) this.examineAll();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.examined.clear();
  }

  private examineAll(): void {
    const surfaces = useSurfaceStore.getState().surfaces;
    const all = [...surfaces.values()];
    for (const surface of all) {
      // A file-backed underlay is final; a computed one may improve when a
      // folded mesh appears, so its key includes the candidate meshes.
      if (surface.curvatureSource?.kind === 'file') continue;
      const folded = anatomicalMeshesFor(surface, all);
      const key = `${surface.metadata.path}|${folded.length}`;
      if (this.examined.get(surface.handle) === key || this.inFlight.has(surface.handle)) continue;
      this.examined.set(surface.handle, key);
      void this.resolve(surface, folded);
    }
    for (const handle of [...this.examined.keys()])
      if (!surfaces.has(handle)) this.examined.delete(handle);
  }

  private async resolve(surface: LoadedSurface, folded: Float32Array[]): Promise<void> {
    this.inFlight.add(surface.handle);
    try {
      const vertexCount = surface.geometry.vertices.length / 3;
      const fromFile = surface.curvatureSource
        ? null
        : await this.readSidecar(surface, vertexCount);
      if (fromFile) {
        useSurfaceStore.getState().setSurfaceCurvature(surface.handle, fromFile.values, {
          kind: 'file',
          path: fromFile.path,
        });
        return;
      }
      if (folded.length === 0 || surface.curvatureSource?.kind === 'computed') return;
      // Off the current task: ~0.3 s at fs_LR 32k.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const values = computeSurfaceSulcalDepth(
        folded[0],
        surface.geometry.faces,
        surface.metadata.hemisphere ?? surface.geometry.hemisphere ?? 'both',
      );
      if (!useSurfaceStore.getState().surfaces.has(surface.handle)) return;
      useSurfaceStore.getState().setSurfaceCurvature(surface.handle, values, {
        kind: 'computed',
        from: 'folded mesh',
      });
    } catch (error) {
      console.warn('[SurfaceCurvatureService] No folding underlay for', surface.name, error);
    } finally {
      this.inFlight.delete(surface.handle);
    }
  }

  /** The first sidecar that reads and matches the vertex count, else null. */
  async readSidecar(
    surface: Pick<LoadedSurface, 'handle' | 'metadata'>,
    vertexCount: number,
  ): Promise<{ path: string; values: Float32Array } | null> {
    const transport = getTransport();
    const candidates = curvatureSidecarCandidates(surface.metadata.path);
    if (candidates.length === 0) return null;
    // Only files the mesh's folder holds: probing missing ones would log
    // load errors for every surface without a sidecar.
    const slash = Math.max(surface.metadata.path.lastIndexOf('/'), surface.metadata.path.lastIndexOf('\\'));
    let present: Set<string>;
    try {
      const nodes = await new FilesystemService(transport).listDirectory(surface.metadata.path.slice(0, Math.max(0, slash)));
      present = new Set(nodes.filter((n) => !n.isDir).map((n) => n.name));
    } catch {
      return null;
    }
    for (const path of candidates) {
      if (!present.has(path.slice(slash + 1))) continue;
      try {
        let values: Float32Array | null = null;
        if (/\.gii$/i.test(path)) {
          const loaded = await transport.invoke<{ handle: string }>('load_surface_overlay', {
            path,
            targetSurfaceId: surface.handle,
          });
          try {
            const raw = await transport.invoke<(number | null)[]>('get_surface_overlay_data', {
              handle: loaded.handle,
            });
            values = Float32Array.from(raw, (v) => (v == null ? 0 : v));
          } finally {
            await transport
              .invoke('unload_surface_overlay', { handle: loaded.handle })
              .catch(() => undefined);
          }
        } else {
          const bytes = toBytes(await transport.invoke(READ_FILE_COMMAND, { path }));
          values = bytes ? parseFreeSurferCurv(bytes) : null;
        }
        if (values && values.length === vertexCount) return { path, values };
      } catch {
        // missing or unreadable: try the next candidate
      }
    }
    return null;
  }
}

let instance: SurfaceCurvatureService | null = null;
export function getSurfaceCurvatureService(): SurfaceCurvatureService {
  instance ??= new SurfaceCurvatureService();
  return instance;
}
