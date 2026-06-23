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

import {
  migrateLayoutSettings,
  useLayoutSettingsStore,
} from "../layoutSettingsStore";

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

  it("starts with the bottom dock open and other defaults nulled / falsey", () => {
    const state = useLayoutSettingsStore.getState();
    expect(state.bottomDockSizes).toBeNull();
    expect(state.bottomDockLogCollapsed).toBe(false);
    expect(state.bottomDockPlotMaximized).toBe(false);
    // The dock is shell-level and shown by default in all imaging modes.
    expect(state.bottomDockOpen).toBe(true);
    expect(state.bottomDockHeight).toBeNull();
    expect(state.orthoArrangement).toBe("grid");
    expect(state.integratedSplit).toBe("horizontal");
    expect(state.goldenLayoutState).toBeNull();
    expect(state.integratedDefaultDisplayMode).toBeNull();
  });

  it("sets and round-trips the ortho arrangement and integrated split", () => {
    useLayoutSettingsStore.getState().setOrthoArrangement("row");
    useLayoutSettingsStore.getState().setIntegratedSplit("vertical");

    expect(useLayoutSettingsStore.getState().orthoArrangement).toBe("row");
    expect(useLayoutSettingsStore.getState().integratedSplit).toBe("vertical");
    expect(readPersistedState()?.state).toMatchObject({
      orthoArrangement: "row",
      integratedSplit: "vertical",
    });
  });

  it("no-ops the arrangement setters when unchanged (referentially stable)", () => {
    useLayoutSettingsStore.getState().setOrthoArrangement("column");
    const before = useLayoutSettingsStore.getState();
    useLayoutSettingsStore.getState().setOrthoArrangement("column");
    expect(useLayoutSettingsStore.getState()).toBe(before);
  });

  describe("v1 → v2 migration (plotDock* → bottomDock*)", () => {
    it("carries over the saved height and drops the old open flag", () => {
      const migrated = migrateLayoutSettings(
        {
          plotDockOpen: false,
          plotDockHeight: 264,
          bottomDockActiveTab: "log",
        },
        1,
      );
      // Saved height is preserved under the new key…
      expect(migrated.bottomDockHeight).toBe(264);
      // …the open flag is intentionally dropped (resets to the new default: open)…
      expect(migrated.plotDockOpen).toBeUndefined();
      expect(migrated.bottomDockOpen).toBeUndefined();
      expect(migrated.plotDockHeight).toBeUndefined();
      // …unrelated keys pass through.
      expect(migrated.bottomDockActiveTab).toBe("log");
    });

    it("leaves already-v2 state untouched", () => {
      const migrated = migrateLayoutSettings(
        { bottomDockOpen: false, bottomDockHeight: 200 },
        2,
      );
      expect(migrated.bottomDockOpen).toBe(false);
      expect(migrated.bottomDockHeight).toBe(200);
    });
  });

  it("closes, toggles, and round-trips the bottom dock open flag", () => {
    useLayoutSettingsStore.getState().setBottomDockOpen(false);
    expect(useLayoutSettingsStore.getState().bottomDockOpen).toBe(false);
    expect(readPersistedState()?.state).toMatchObject({
      bottomDockOpen: false,
    });

    useLayoutSettingsStore.getState().toggleBottomDock();
    expect(useLayoutSettingsStore.getState().bottomDockOpen).toBe(true);

    useLayoutSettingsStore.getState().toggleBottomDock();
    expect(useLayoutSettingsStore.getState().bottomDockOpen).toBe(false);
  });

  it("no-ops setBottomDockOpen when the value is unchanged", () => {
    const setter = useLayoutSettingsStore.getState().setBottomDockOpen;
    setter(false);
    const before = useLayoutSettingsStore.getState();
    setter(false);
    expect(useLayoutSettingsStore.getState()).toBe(before);
  });

  it("rounds and round-trips the bottom dock height", () => {
    useLayoutSettingsStore.getState().setBottomDockHeight(247.6);
    expect(useLayoutSettingsStore.getState().bottomDockHeight).toBe(248);
    expect(readPersistedState()?.state).toMatchObject({
      bottomDockHeight: 248,
    });
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
