/** Shared, inspectable log for the full-app harness (read by the Playwright capture spec). */

export interface HarnessCall {
  cmd: string;
  via: 'transport' | 'internals';
}

export interface HarnessLog {
  scenario: string;
  calls: HarnessCall[];
  /** Commands with no handler; they resolved to a safe default (`null`). */
  unknown: string[];
  /** Handler threw; the error was propagated to the caller. */
  errors: Array<{ cmd: string; message: string }>;
  /** Places where the scenario seeded a store instead of driving a real service. */
  fallbacks: string[];
  /** Scenario steps completed, in order. */
  steps: string[];
  pageErrors: string[];
  /** Cross-origin fetches the harness refused (it is offline by design). */
  offline: string[];
  /** Toast messages observed before they expired. */
  toasts: string[];
  pending: number;
}

declare global {
  interface Window {
    __harnessLog: HarnessLog;
    __harnessReady?: boolean;
    __harnessFailed?: string;
  }
}

export function createHarnessLog(scenario: string): HarnessLog {
  const log: HarnessLog = {
    scenario,
    calls: [],
    unknown: [],
    errors: [],
    fallbacks: [],
    steps: [],
    pageErrors: [],
    offline: [],
    toasts: [],
    pending: 0,
  };
  window.__harnessLog = log;
  window.addEventListener('error', (event) => {
    log.pageErrors.push(String(event.message ?? event.error));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | undefined;
    log.pageErrors.push(`unhandledrejection: ${reason?.message ?? String(event.reason)}`);
  });
  return log;
}

export function harnessLog(): HarnessLog {
  return window.__harnessLog;
}

export function noteFallback(message: string): void {
  harnessLog().fallbacks.push(message);
}

export function noteStep(message: string): void {
  harnessLog().steps.push(message);
}
