/**
 * layoutSettingsStore — persistence + setter semantics
 * (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`).
 *
 * The store backs the bottom dock's pane sizes, log-collapsed flag,
 * plot-maximized flag, the Golden Layout root config, and the cold-start
 * display-mode preference. All of these must round-trip through
 * localStorage so a refresh keeps the user's last layout.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { useLayoutSettingsStore } from "../layoutSettingsStore";

const STORAGE_KEY = "brainflow2-layout-settings";

function readPersistedState(): Record<string, unknown> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe("layoutSettingsStore", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it("starts with all defaults nulled / falsey", () => {
    const state = useLayoutSettingsStore.getState();
    expect(state.bottomDockSizes).toBeNull();
    expect(state.bottomDockLogCollapsed).toBe(false);
    expect(state.bottomDockPlotMaximized).toBe(false);
    expect(state.plotDockOpen).toBe(false);
    expect(state.plotDockHeight).toBeNull();
    expect(state.goldenLayoutState).toBeNull();
    expect(state.integratedDefaultDisplayMode).toBeNull();
  });

  it("opens, toggles, and round-trips the plot dock open flag", () => {
    useLayoutSettingsStore.getState().setPlotDockOpen(true);
    expect(useLayoutSettingsStore.getState().plotDockOpen).toBe(true);
    expect(readPersistedState()?.state).toMatchObject({ plotDockOpen: true });

    useLayoutSettingsStore.getState().togglePlotDock();
    expect(useLayoutSettingsStore.getState().plotDockOpen).toBe(false);

    useLayoutSettingsStore.getState().togglePlotDock();
    expect(useLayoutSettingsStore.getState().plotDockOpen).toBe(true);
  });

  it("no-ops setPlotDockOpen when the value is unchanged", () => {
    const setter = useLayoutSettingsStore.getState().setPlotDockOpen;
    setter(true);
    const before = useLayoutSettingsStore.getState();
    setter(true);
    expect(useLayoutSettingsStore.getState()).toBe(before);
  });

  it("rounds and round-trips the plot dock height", () => {
    useLayoutSettingsStore.getState().setPlotDockHeight(247.6);
    expect(useLayoutSettingsStore.getState().plotDockHeight).toBe(248);
    expect(readPersistedState()?.state).toMatchObject({ plotDockHeight: 248 });
  });

  it("round-trips bottom dock sizes through localStorage", () => {
    useLayoutSettingsStore.getState().setBottomDockSizes([400, 240, 80]);
    const persisted = readPersistedState();
    expect(persisted?.state).toMatchObject({
      bottomDockSizes: [400, 240, 80],
    });
  });

  it("no-ops when sizes are unchanged (referentially stable)", () => {
    const setter = useLayoutSettingsStore.getState().setBottomDockSizes;
    setter([400, 240, 80]);
    const before = useLayoutSettingsStore.getState();
    setter([400, 240, 80]);
    const after = useLayoutSettingsStore.getState();
    expect(after).toBe(before);
  });

  it("round-trips log-collapsed and plot-maximized flags", () => {
    useLayoutSettingsStore.getState().setBottomDockLogCollapsed(true);
    useLayoutSettingsStore.getState().setBottomDockPlotMaximized(true);

    const persisted = readPersistedState();
    expect(persisted?.state).toMatchObject({
      bottomDockLogCollapsed: true,
      bottomDockPlotMaximized: true,
    });
  });

  it("round-trips a saved Golden Layout config (opaque JSON)", () => {
    const fakeLayout = { root: { type: "row", content: [] }, header: {} };
    useLayoutSettingsStore.getState().setGoldenLayoutState(fakeLayout);

    const persisted = readPersistedState();
    expect(
      (persisted?.state as { goldenLayoutState: unknown })?.goldenLayoutState,
    ).toEqual(fakeLayout);
  });

  it("round-trips integratedDefaultDisplayMode", () => {
    useLayoutSettingsStore
      .getState()
      .setIntegratedDefaultDisplayMode("integrated");
    const persisted = readPersistedState();
    expect(persisted?.state).toMatchObject({
      integratedDefaultDisplayMode: "integrated",
    });
  });

  it("resetLayoutSettings restores defaults but does not erase the persisted record", () => {
    useLayoutSettingsStore.getState().setBottomDockSizes([1, 2, 3]);
    useLayoutSettingsStore
      .getState()
      .setIntegratedDefaultDisplayMode("orthogonal-flexible");
    useLayoutSettingsStore.getState().resetLayoutSettings();

    const state = useLayoutSettingsStore.getState();
    expect(state.bottomDockSizes).toBeNull();
    expect(state.integratedDefaultDisplayMode).toBeNull();
  });
});
