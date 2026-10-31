/**
 * Reloading a placeholder surface tab (qa-features-2026-10-31 §9): check that
 * its sources are still there, and load them on request. A loaded surface
 * opens (or joins) its own surface tab through the normal load path, so the
 * placeholder closes once one of them is back.
 */

import type { SurfaceTabSource } from '@/stores/surfaceTabRestoreStore';

export interface SurfaceReloadBackend {
  /** Names in a directory; rejects when the directory is gone. */
  listDirectory(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
  loadSurfaceFile(path: string): Promise<string | null>;
  loadSurfaceTemplate(request: {
    space: string;
    geometry_type: string;
    hemisphere: string;
  }): Promise<string | null>;
}

function splitPath(path: string): { directory: string; name: string } {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { directory: path.slice(0, Math.max(0, slash)) || '/', name: path.slice(slash + 1) };
}

/**
 * The file sources that are gone. Templates are always available (from the
 * cache, or downloaded on reload).
 */
export async function missingSurfaceSources(
  sources: readonly SurfaceTabSource[],
  backend: Pick<SurfaceReloadBackend, 'listDirectory'>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const source of sources) {
    if (source.kind !== 'file') continue;
    const { directory, name } = splitPath(source.path);
    try {
      const entries = await backend.listDirectory(directory);
      if (!entries.some((entry) => !entry.isDir && entry.name === name)) missing.push(source.path);
    } catch {
      missing.push(source.path);
    }
  }
  return missing;
}

/** Load the tab's surfaces in order. Returns how many came back. */
export async function reloadSurfaceSources(
  sources: readonly SurfaceTabSource[],
  backend: Pick<SurfaceReloadBackend, 'loadSurfaceFile' | 'loadSurfaceTemplate'>,
): Promise<number> {
  let loaded = 0;
  for (const source of sources) {
    try {
      const handle =
        source.kind === 'template'
          ? await backend.loadSurfaceTemplate({
              space: source.space,
              geometry_type: source.geometryType,
              hemisphere: source.hemisphere,
            })
          : await backend.loadSurfaceFile(source.path);
      if (handle) loaded += 1;
    } catch (error) {
      // The load path reports its own failure (toast and Log).
      console.warn('[surfaceTabReload] Reload failed:', source.path, error);
    }
  }
  return loaded;
}

/** The app's backend: the filesystem service and SurfaceLoadingService. */
export async function defaultSurfaceReloadBackend(): Promise<SurfaceReloadBackend> {
  const [{ getApiService }, { getSurfaceLoadingService }] = await Promise.all([
    import('@/services/apiService'),
    import('@/services/SurfaceLoadingService'),
  ]);
  return {
    listDirectory: (path) => getApiService().listDirectory(path, 1),
    loadSurfaceFile: (path) => getSurfaceLoadingService().loadSurfaceFile({ path }),
    loadSurfaceTemplate: (request) => getSurfaceLoadingService().loadSurfaceTemplate(request),
  };
}
