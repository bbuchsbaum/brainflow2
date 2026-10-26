/** Quiescence detection for the full-app harness. */
import { harnessLog } from './harnessLog';

const IDLE_FRAMES = 12;
const TIMEOUT_MS = 20000;

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextFrame();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve when `predicate` holds, polling once per frame. */
export async function until(
  predicate: () => boolean,
  label: string,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`harness timed out waiting for: ${label}`);
    }
    await nextFrame();
  }
}

/**
 * GoldenLayout sizes the side stacks' content only on a container/window
 * resize; a native Tauri window delivers one at startup, a headless page does
 * not (side panels stay 2 px tall and virtualized lists render no rows).
 * Simulate that single startup resize once the layout exists.
 */
export async function settleInitialLayout(): Promise<void> {
  await until(
    () => document.querySelector('.lm_goldenlayout .lm_content') !== null,
    'GoldenLayout content',
  );
  window.dispatchEvent(new Event('resize'));
  harnessLog().steps.push('dispatched initial window resize');
  await delay(250);
  await frames(2);
}

/**
 * Observed: after a layout rebuild (e.g. the first volume load) GoldenLayout's
 * side stacks can again end up with an unsized (2 px) content area until the
 * next window resize. If any stack is collapsed like that, deliver one resize
 * and record it, so reviewers can see the harness intervened.
 */
async function nudgeCollapsedStacks(): Promise<void> {
  const collapsed = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.lm_stack')).filter((stack) => {
      const items = stack.querySelector<HTMLElement>(':scope > .lm_items');
      return stack.getBoundingClientRect().height > 100 && !!items && items.getBoundingClientRect().height < 10;
    }).length;
  const before = collapsed();
  if (before === 0) return;
  window.dispatchEvent(new Event('resize'));
  await delay(250);
  await frames(2);
  harnessLog().fallbacks.push(
    `layout: ${before} GoldenLayout stack(s) had a collapsed content area; dispatched window resize (now ${collapsed()} collapsed)`,
  );
}

/**
 * Fonts loaded, GoldenLayout laid out, zero in-flight backend calls and no new
 * calls for IDLE_FRAMES consecutive animation frames (plus a short timer gap,
 * so debounced work scheduled with setTimeout gets a chance to fire).
 */
export async function waitForQuiescence(): Promise<void> {
  await document.fonts.ready;
  await until(
    () => document.querySelector('.lm_goldenlayout .lm_content') !== null,
    'GoldenLayout content',
  );
  const log = harnessLog();
  await nudgeCollapsedStacks();
  const start = performance.now();
  let stableFrames = 0;
  let lastCalls = log.calls.length;
  let rounds = 0;
  while (stableFrames < IDLE_FRAMES) {
    if (performance.now() - start > TIMEOUT_MS) {
      throw new Error(
        `harness never went idle (pending=${log.pending}, calls=${log.calls.length})`,
      );
    }
    await nextFrame();
    if (log.pending === 0 && log.calls.length === lastCalls) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
      lastCalls = log.calls.length;
    }
    if (stableFrames === IDLE_FRAMES && rounds < 2) {
      // Let debounced timers (resize observers, 100-300 ms debounces) fire, then re-check.
      rounds += 1;
      await delay(400);
      if (log.calls.length !== lastCalls || log.pending !== 0) {
        stableFrames = 0;
        lastCalls = log.calls.length;
      }
    }
  }
  await waitForToastsToExpire();
  await document.fonts.ready;
}

/**
 * NotificationToast auto-dismisses after 5 s on a real timer. Whether a toast is
 * still on screen at capture time would otherwise depend on scenario duration,
 * so readiness waits until every toast has expired (messages are logged first).
 */
export async function waitForToastsToExpire(timeoutMs = 8000): Promise<void> {
  const selector = '[data-testid="status-notification"]';
  const log = harnessLog();
  const seen = new Set<string>();
  const start = performance.now();
  while (document.querySelector(selector)) {
    document.querySelectorAll(selector).forEach((el) => {
      const text = el.textContent ?? '';
      if (!seen.has(text)) {
        seen.add(text);
        log.toasts.push(text);
      }
    });
    if (performance.now() - start > timeoutMs) break;
    await delay(100);
  }
  await frames(2);
}
