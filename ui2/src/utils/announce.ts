/**
 * Screen-reader announcements for outcomes that have no focusable result:
 * "4 clusters, 873 voxels", "Moved to max z 5.97 at −38, −18, 50 mm". One
 * visually hidden polite live region, created on first use. Repeating the
 * same text re-announces it (the region is cleared first).
 */
const REGION_ID = 'bf-live-announcer';

function region(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(REGION_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = REGION_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    el.dataset.testid = 'live-announcer';
    document.body.appendChild(el);
  }
  return el;
}

export function announce(message: string): void {
  const el = region();
  if (!el) return;
  el.textContent = '';
  const set = () => {
    el.textContent = message;
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set);
  else set();
}
