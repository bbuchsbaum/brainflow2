import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "@/types/filesystem";

const listDirectory = vi.fn();
const cachedRemoteDirectory = vi.fn();

vi.mock("@/services/apiService", () => ({
  getApiService: () => ({ listDirectory, cachedRemoteDirectory }),
}));

import { useFileBrowserStore } from "@/stores/fileBrowserStore";

function root(path: string, remote: boolean): FileTreeNode {
  return {
    id: path,
    name: "root",
    path,
    type: "directory",
    depth: 0,
    expanded: false,
    children: [],
    mountSource: remote ? { kind: "remote", host: "h", mountId: "m" } : { kind: "local" },
  } as FileTreeNode;
}

const node = (id: string, name: string) => ({ id, name, isDir: false, parentIdx: null, iconId: 0 });

describe("fileBrowserStore remote listing cache", () => {
  beforeEach(() => {
    listDirectory.mockReset();
    cachedRemoteDirectory.mockReset();
    useFileBrowserStore.setState({ entries: [], loading: false, error: null });
  });

  it("shows the remembered listing of a remote folder until the live one arrives", async () => {
    let resolveLive: (nodes: unknown[]) => void = () => {};
    listDirectory.mockReturnValue(new Promise((resolve) => (resolveLive = resolve)));
    cachedRemoteDirectory.mockResolvedValue([node("/cache/r/old.nii", "old.nii")]);
    useFileBrowserStore.setState({ entries: [root("/cache/r", true)] });

    const load = useFileBrowserStore.getState().loadDirectory("/cache/r");

    await vi.waitFor(() => {
      expect(useFileBrowserStore.getState().entries[0].children?.map((c) => c.name)).toEqual([
        "old.nii",
      ]);
    });
    expect(useFileBrowserStore.getState().loadingPaths.has("/cache/r")).toBe(true);

    resolveLive([node("/cache/r/new.nii", "new.nii"), node("/cache/r/old.nii", "old.nii")]);
    await load;
    expect(useFileBrowserStore.getState().entries[0].children?.map((c) => c.name)).toEqual([
      "new.nii",
      "old.nii",
    ]);
  });

  it("never asks for a cached listing of a local folder", async () => {
    listDirectory.mockResolvedValue([node("/local/a.nii", "a.nii")]);
    useFileBrowserStore.setState({ entries: [root("/local", false)] });
    await useFileBrowserStore.getState().loadDirectory("/local");
    expect(cachedRemoteDirectory).not.toHaveBeenCalled();
  });

  it("does not let a late cached listing replace the live one", async () => {
    let resolveCached: (nodes: unknown[]) => void = () => {};
    cachedRemoteDirectory.mockReturnValue(new Promise((resolve) => (resolveCached = resolve)));
    listDirectory.mockResolvedValue([node("/cache/r/live.nii", "live.nii")]);
    useFileBrowserStore.setState({ entries: [root("/cache/r", true)] });

    await useFileBrowserStore.getState().loadDirectory("/cache/r");
    resolveCached([node("/cache/r/stale.nii", "stale.nii")]);
    await Promise.resolve();
    expect(useFileBrowserStore.getState().entries[0].children?.map((c) => c.name)).toEqual([
      "live.nii",
    ]);
  });
});
