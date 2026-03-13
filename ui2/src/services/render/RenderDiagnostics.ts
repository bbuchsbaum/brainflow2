export type RenderDiagnosticStage =
  | 'coalesce.flush'
  | 'render-coordinator.single'
  | 'render-coordinator.batch'
  | 'api.render_view'
  | 'api.submit_view'
  | 'api.render_views';

export interface RenderDiagnosticEntry {
  stage: RenderDiagnosticStage;
  durationMs: number;
  timestamp: number;
  detail?: Record<string, unknown>;
}

const MAX_ENTRIES = 200;
let entries: RenderDiagnosticEntry[] = [];

export function recordRenderDiagnostic(
  stage: RenderDiagnosticStage,
  durationMs: number,
  detail?: Record<string, unknown>
): void {
  const sanitizedDuration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
  entries.push({
    stage,
    durationMs: sanitizedDuration,
    timestamp: performance.now(),
    detail
  });

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

export function recordRenderDuration(
  stage: RenderDiagnosticStage,
  startedAt: number,
  detail?: Record<string, unknown>
): void {
  recordRenderDiagnostic(stage, performance.now() - startedAt, detail);
}

export function getRenderDiagnostics(): RenderDiagnosticEntry[] {
  return [...entries];
}

export function clearRenderDiagnostics(): void {
  entries = [];
}
