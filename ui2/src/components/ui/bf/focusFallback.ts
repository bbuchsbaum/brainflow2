/**
 * Focus fallback for controls that remove themselves (Dismiss, "+ Panel" in
 * an empty state, "Select <layer>", a popover choice that closes it): after
 * the click, if focus fell to <body>, move it to the first candidate still in
 * the document. Without this, keyboard users land at the top of the page
 * (v4 function critic: four drops to <body>).
 *
 * Candidates are elements, selectors, or getters, tried in order. Runs after
 * two frames (React has committed and any closing popover has returned focus).
 */
export type FocusCandidate = HTMLElement | string | (() => HTMLElement | null | undefined) | null | undefined;

function resolve(candidate: FocusCandidate, root: ParentNode): HTMLElement | null {
  if (!candidate) return null;
  if (typeof candidate === 'string') return root.querySelector<HTMLElement>(candidate);
  if (typeof candidate === 'function') return candidate() ?? null;
  return candidate;
}

function focusable(el: HTMLElement | null): el is HTMLElement {
  return (
    !!el &&
    el.isConnected &&
    !el.hasAttribute('disabled') &&
    el.getAttribute('aria-hidden') !== 'true'
  );
}

/** True when nothing useful has focus (body, nothing, or a removed node). */
export function focusIsLost(doc: Document = document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !(active as HTMLElement).isConnected;
}

export function focusFallback(
  candidates: readonly FocusCandidate[],
  options: { root?: ParentNode; force?: boolean } = {},
): void {
  const run = () => {
    if (!options.force && !focusIsLost()) return;
    const root = options.root ?? document;
    for (const candidate of candidates) {
      const el = resolve(candidate, root);
      if (focusable(el)) {
        el.focus();
        return;
      }
    }
  };
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(run, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(run));
}
