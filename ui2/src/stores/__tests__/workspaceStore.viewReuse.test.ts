import { describe, it } from "vitest";

/**
 * Single-view-tab reuse was prototyped here but REVERTED after adversarial
 * review (Codex council, 2026-06-23): putting the "visualization family is a
 * singleton" guard inside the generic `createWorkspace` broke explicit
 * creation paths — notably FileTreeRow "Open In New Tab"
 * (-> DisplayLifecycleOrchestrator `new-workspace` -> createWorkspace without
 * opt-out) and the comparison-ensure flows
 * (DisplayLifecycleOrchestrator / StudioDisplayService createWorkspace('comparison')).
 * It also reused the FIRST visualization workspace, not the active one.
 *
 * The proper fix (tab-proliferation) belongs on the MODE-SWITCH path
 * (DisplayModeSelector pills + the native View-menu mode items already use
 * `setActiveWorkspaceMode` in place), and/or by correcting the default load
 * intent — NOT in `createWorkspace`. It also needs a product decision on
 * whether Comparison is a center display mode or a separate destination, and
 * in-app verification. Tracked for the app-paired follow-up.
 */
describe("workspaceStore — single view tab reuse (reverted; see follow-up)", () => {
  it.todo(
    "reuse on mode-switch path only (active-tab target), preserving explicit Open-In-New-Tab + comparison-ensure",
  );
});
