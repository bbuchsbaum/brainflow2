import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "@/types/filesystem";

const listDirectory = vi.fn();

vi.mock("@/services/apiService", () => ({
  getApiService: () => ({ listDirectory }),
}));

import { useFileBrowserStore } from "@/stores/fileBrowserStore";

function collapsedDir(path: string, name: string): FileTreeNode {
  return {
    id: path,
    name,
    path,
    type: "directory",
    depth: 0,
    expanded: false,
    children: [],
  } as FileTreeNode;
}

const apiNodes = [
  {
    id: "/root/sub/a.nii.gz",
    name: "a.nii.gz",
    isDir: false,
    parentIdx: null,
    iconId: 0,
  },
  {
    id: "/root/sub/child",
    name: "child",
    isDir: true,
    parentIdx: null,
    iconId: 0,
  },
];

describe("fileBrowserStore.prefetchDirectory", () => {
  beforeEach(() => {
    listDirectory.mockReset();
    useFileBrowserStore.setState({ entries: [], loading: false, error: null });
  });

  it("populates a collapsed folder's children without flipping the global loading flag", async () => {
    listDirectory.mockResolvedValue(apiNodes);
    useFileBrowserStore.setState({
      entries: [collapsedDir("/root/sub", "sub")],
    });

    useFileBrowserStore.getState().prefetchDirectory("/root/sub");

    await vi.waitFor(() => {
      const node = useFileBrowserStore.getState().entries[0];
      expect(node.children?.length).toBe(2);
    });

    // Prefetch must stay silent: never touches the panel-wide loading flag,
    // and never auto-expands the node (that's the click's job).
    expect(useFileBrowserStore.getState().loading).toBe(false);
    expect(useFileBrowserStore.getState().entries[0].expanded).toBe(false);
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it("de-dupes an in-flight prefetch and skips an already-loaded folder", async () => {
    let resolveList: (value: unknown) => void = () => {};
    listDirectory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    useFileBrowserStore.setState({
      entries: [collapsedDir("/root/sub", "sub")],
    });

    const store = useFileBrowserStore.getState();
    store.prefetchDirectory("/root/sub");
    store.prefetchDirectory("/root/sub"); // concurrent duplicate
    expect(listDirectory).toHaveBeenCalledTimes(1);

    resolveList(apiNodes);
    await vi.waitFor(() =>
      expect(useFileBrowserStore.getState().entries[0].children?.length).toBe(
        2,
      ),
    );

    // Already loaded → no further fetch.
    store.prefetchDirectory("/root/sub");
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });
});
