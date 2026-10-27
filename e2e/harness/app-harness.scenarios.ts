/**
 * Shared specimen lists for the full-app harness (ui2/app-harness.html),
 * used by the capture spec (hill-climb specimens) and the visual gate
 * (toHaveScreenshot baselines), so both always cover the same set.
 */

export const SCENARIOS = [
  'empty',
  'volume',
  'volume-surface',
  'inspector-layer',
  'overlay',
  'overlay-colorbar',
  'compare',
  'keyboard-focus',
  'keyboard-focus-switcher',
  'plots',
  'mosaic',
  'analysis',
  'bids',
  'studio',
  'dialog-goto',
  'dialog-header',
  'dialog-crosshair',
  'surface-settings',
  'dialog-remote-mount',
];

/**
 * Extra viewport variants: [scenario, width, height]. `integrated` runs the
 * volume-surface driver and exists only here, so its file is
 * `integrated@1280x800` (staged as `integrated-1280`).
 */
export const VARIANTS: Array<[string, number, number]> = [
  ['volume', 1280, 800],
  ['inspector-layer', 1280, 800],
  ['integrated', 1280, 800],
];

/**
 * Phase 3 hill-climb specimens (.hillclimb/p3). Capture-only and opt-in: the
 * capture spec runs one when APP_HARNESS_SCENARIOS names it (or contains `p3`
 * for all of them); the visual gate never iterates these lists.
 */
export const P3_SCENARIOS = [
  'stat-overlay-z',
  'stat-overlay-t',
  'header-stat',
  'region-at-crosshair',
  'voxel-nav',
  'goto-voxel',
  'cluster-table',
  'multi-layer-readout',
  'mosaic-labelled',
  'export-dialog',
  'export-mosaic',
  'export-orthogonal',
  'export-error',
  'compare-linked',
  'empty-compare',
  'empty-mosaic',
  'empty-plot-dock',
  'plot-dock',
  'plot-dock-labels',
  'clusters-no-stat',
  'empty-clusters',
  'surface-frame',
  // Each camera preset gives its named view (v4 user critic).
  'surface-preset-lateral',
  'surface-preset-medial',
  'surface-preset-dorsal',
  'surface-preset-anterior',
  // Native-like statistics with no scenario-set window (v6 native check).
  'native-zmap',
  'native-tmap',
  'native-export-crop',
  'native-export-crop-zfirst',
  'crosshair-letter-knockout',
  // Phase 4 D (surface figures): folding underlay, right hemisphere, the
  // lateral + medial export, the status-bar vertex readout.
  'surface-curvature',
  'surface-rh-lateral',
  'surface-export-latmed',
  'surface-status-vertex',
  // Phase 4 C1/C2: sub-peaks open, cluster-level p (RFT) with its assumption.
  'cluster-subpeaks-rft',
];

/** Phase 3 viewport variants (capture-only): `files` exists only at 1280x800. */
export const P3_VARIANTS: Array<[string, number, number]> = [
  ['files', 1280, 800],
  // Label map over a t map at the narrow width: the status bar must fit.
  ['region-at-crosshair', 1280, 800],
  // The cluster table and the status bar at the narrow width (v2 critics).
  ['cluster-table', 1280, 800],
  // The mosaic's Auto grid at the narrow width (user: tiles were cramped).
  ['mosaic-labelled', 1280, 800],
  // The export modal must fit the window (title and Save visible).
  ['export-dialog', 1280, 800],
  ['export-mosaic', 1280, 800],
];

/** Gallery pages of ui/bf primitives (primitives-harness.html): [query page, file]. */
export const PRIMITIVE_PAGES: Array<[string, string]> = [
  ['1', 'primitives'],
  ['2', 'primitives-2'],
  ['3', 'primitives-3'],
  ['4', 'primitives-4'],
];

/** Freezes animation, transitions and the caret (installed by an init script). */
export const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

/** Installs `css` as a <style data-app-harness=…> as early as the document allows. */
export function installStyleScript([css, tag]: [string, string]): void {
  const install = () => {
    const style = document.createElement('style');
    style.setAttribute('data-app-harness', tag);
    style.textContent = css;
    document.head.appendChild(style);
  };
  if (document.head) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
}

declare global {
  interface Window {
    __harnessReady?: boolean;
    __harnessFailed?: string;
    __harnessLog: {
      calls: Array<{ cmd: string }>;
      unknown: string[];
      errors: Array<{ cmd: string; message: string }>;
      fallbacks: string[];
      pageErrors: string[];
    };
  }
}
