import React, { Suspense } from 'react';
import type { SurfaceViewPanelProps } from './SurfaceViewPanel';

/**
 * Lazy boundary for the surface viewer.
 *
 * `SurfaceViewPanel` statically pulls in `SurfaceViewCanvas` -> `neurosurface`
 * -> Three.js (~550 KB+). Importing it eagerly forced all of that into the main
 * bundle even though cold-start workspaces render slices only and never mount a
 * surface. Routing every importer through this `React.lazy` boundary lets Vite
 * code-split the surface renderer into its own chunk, fetched on demand the
 * first time a surface view is actually opened.
 *
 * The type-only import above is erased at build time, so it does not re-link the
 * heavy module into the main chunk.
 */
const SurfaceViewPanelImpl = React.lazy(() =>
  import('./SurfaceViewPanel').then((m) => ({ default: m.SurfaceViewPanel })),
);

export const SurfaceViewPanel: React.FC<SurfaceViewPanelProps> = (props) => (
  <Suspense
    fallback={
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        Loading surface viewer…
      </div>
    }
  >
    <SurfaceViewPanelImpl {...props} />
  </Suspense>
);
