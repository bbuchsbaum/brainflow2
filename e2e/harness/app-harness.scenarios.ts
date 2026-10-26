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
