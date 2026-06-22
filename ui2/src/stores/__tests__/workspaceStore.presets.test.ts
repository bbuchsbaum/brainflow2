import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { WORKSPACE_PRESETS } from "@/types/workspacePresets";
import { initializeViewRegistry } from "@/services/ViewRegistry";

describe("workspace presets", () => {
  beforeEach(() => {
    localStorage.clear();
    initializeViewRegistry();
    useWorkspaceStore.setState({
      workspaces: new Map(),
      activeWorkspaceId: null,
    });
  });

  it("defines six core presets", () => {
    expect(WORKSPACE_PRESETS.map((preset) => preset.id)).toEqual([
      "read",
      "explore",
      "analyze",
      "compare",
      "studio",
      "bids",
    ]);
  });

  it("reuses existing workspace when the same preset is applied again", async () => {
    const firstWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("read");
    const secondWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("read");

    const state = useWorkspaceStore.getState();
    expect(secondWorkspaceId).toBe(firstWorkspaceId);
    expect(state.workspaces.size).toBe(1);
    expect(state.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(state.workspaces.get(firstWorkspaceId)?.presetId).toBe("read");
  });

  it("creates distinct workspaces for different presets", async () => {
    const readWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("read");
    const compareWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("compare");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces.size).toBe(2);
    expect(readWorkspaceId).not.toBe(compareWorkspaceId);
    expect(state.activeWorkspaceId).toBe(compareWorkspaceId);
    expect(state.workspaces.get(compareWorkspaceId)?.presetId).toBe("compare");
  });

  it('uses a neutral "View" title for pill-reachable view workspaces (so tabs do not echo the mode pills)', async () => {
    const workspaceId = await useWorkspaceStore
      .getState()
      .createWorkspace("comparison");
    expect(
      useWorkspaceStore.getState().workspaces.get(workspaceId)?.title,
    ).toBe("View");
  });

  it("switches the active workspace mode in place without changing which tab is active", async () => {
    const workspaceId = await useWorkspaceStore
      .getState()
      .createWorkspace("orthogonal-locked");
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe(workspaceId);

    // Different mode → mutates the active workspace's type in place.
    state.setActiveWorkspaceMode("mosaic");
    const afterMosaic = useWorkspaceStore.getState();
    expect(afterMosaic.workspaces.get(workspaceId)?.type).toBe("mosaic");
    expect(afterMosaic.activeWorkspaceId).toBe(workspaceId);

    // Re-clicking the resolved-current mode is a no-op (keeps flexible flexible).
    await useWorkspaceStore.getState().createWorkspace("orthogonal-flexible");
    const flexId = useWorkspaceStore.getState().activeWorkspaceId!;
    useWorkspaceStore.getState().setActiveWorkspaceMode("orthogonal");
    expect(useWorkspaceStore.getState().workspaces.get(flexId)?.type).toBe(
      "orthogonal-flexible",
    );
  });

  it("dissociates a workspace from its preset when the pill changes its mode (menu stays a launcher)", async () => {
    const readId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("read");
    expect(useWorkspaceStore.getState().workspaces.get(readId)?.presetId).toBe(
      "read",
    );
    expect(useWorkspaceStore.getState().getWorkspaceByPreset("read")?.id).toBe(
      readId,
    );

    // Pill → Mosaic reconfigures the active Read view in place...
    useWorkspaceStore.getState().setActiveWorkspaceMode("mosaic");
    const mutated = useWorkspaceStore.getState().workspaces.get(readId);
    expect(mutated?.type).toBe("mosaic");
    // ...and it is no longer "the Read preset", so the launcher (which matches
    // on presetId) will no longer reactivate this now-Mosaic tab when Read is
    // picked again — it opens a fresh orthogonal view instead.
    expect(mutated?.presetId).toBeNull();
    expect(
      useWorkspaceStore.getState().getWorkspaceByPreset("read"),
    ).toBeNull();
  });
});
