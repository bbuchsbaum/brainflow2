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

  it("keeps presets only for tools (the view presets were retired)", () => {
    expect(WORKSPACE_PRESETS.map((preset) => preset.id)).toEqual([
      "studio",
      "bids",
    ]);
  });

  it("reuses the tool tab when its preset is applied again", async () => {
    const firstWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("studio");
    const secondWorkspaceId = await useWorkspaceStore
      .getState()
      .applyWorkspacePreset("studio");

    const state = useWorkspaceStore.getState();
    expect(secondWorkspaceId).toBe(firstWorkspaceId);
    expect(state.workspaces.size).toBe(1);
    expect(state.workspaces.get(firstWorkspaceId)?.presetId).toBe("studio");
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

  it("sets an exact view type in place, and never reconfigures a tool tab", async () => {
    const viewId = await useWorkspaceStore
      .getState()
      .createWorkspace("orthogonal-locked");
    useWorkspaceStore.getState().setActiveWorkspaceType("orthogonal-flexible");
    expect(useWorkspaceStore.getState().workspaces.get(viewId)?.type).toBe(
      "orthogonal-flexible",
    );

    const toolId = await useWorkspaceStore
      .getState()
      .createWorkspace("bids-explorer");
    useWorkspaceStore.getState().setActiveWorkspaceType("mosaic");
    useWorkspaceStore.getState().setActiveWorkspaceMode("mosaic");
    expect(useWorkspaceStore.getState().workspaces.get(toolId)?.type).toBe(
      "bids-explorer",
    );
  });
});
