import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Tree, type TreeApi } from "react-arborist";
import { VscFolder } from "react-icons/vsc";
import "./FileBrowserPanel.css";
import { useFileBrowserStore } from "@/stores/fileBrowserStore";
import { findOwningRoot, nodeMatchesQuery } from "@/stores/fileBrowserSearch";
import type { FileTreeNode } from "@/types/filesystem";
import { getEventBus } from "@/events/EventBus";
import type { DisplayOpenIntent } from "@/types/loadIntent";
import { getTransport } from "@/services/transport";
import { getSetStudioService } from "@/services/studio/SetStudioService";
import { getImageSetService } from "@/services/ImageSetService";
import {
  mountConnectedRemoteDirectory,
  type ConnectedRemoteMount,
} from "@/services/RemoteMountService";
import { PanelErrorBoundary } from "../common/PanelErrorBoundary";
import { PanelHeader } from "@/components/ui/PanelHeader";
import { RemoteMountDialog } from "./RemoteMountDialog";
import {
  FileTreeItemRow,
  FileTreeRow,
  type FileNodeData,
} from "./files/FileTreeRow";
import { handleTreeTabCapture } from "./files/treeTabEscape";
import { FilesStartPanel } from "./files/FilesStartPanel";
import { SourceHeader } from "./files/SourceHeader";
import { FilterBar } from "./files/FilterBar";
import { SelectedFileSummary } from "./files/SelectedFileSummary";
import { FilesFooterStatus } from "./files/FilesFooterStatus";
import { ViewModeTabs, filesViewPanelProps } from "./files/ViewModeTabs";
import { Button, Notice } from "@/components/ui/bf";
import { ImagesView } from "./files/ImagesView";
import { LoadedView } from "./files/LoadedView";
import { BidsView } from "./files/BidsView";
import { useKeyboardNavWithin } from "./files/useKeyboardNavWithin";

const FileBrowserPanelContent: React.FC = () => {
  const fileBrowserStore = useFileBrowserStore();
  const [searchInput, setSearchInput] = useState("");
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [mountActionError, setMountActionError] = useState<string | null>(null);
  const [mountActionPending, setMountActionPending] = useState(false);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const treeResizeObserverRef = useRef<ResizeObserver | null>(null);
  // Folders the user opened (outside a search), so a remounted tree (a new
  // root, the search empty state) opens them again (QA 2026-10-30 F46:
  // clearing a search collapsed every folder).
  const treeApiRef = useRef<TreeApi<FileNodeData> | null>(null);
  const openFolderIdsRef = useRef<Set<string>>(new Set());
  const handleTreeToggle = useCallback((id: string) => {
    const api = treeApiRef.current;
    // A search has its own open state; the user's folders are the unfiltered one.
    if (!api || api.isFiltered) return;
    if (api.isOpen(id)) openFolderIdsRef.current.add(id);
    else openFolderIdsRef.current.delete(id);
  }, []);

  // Reactive values from store
  const currentPath = useFileBrowserStore((state) => state.currentPath);
  const rootPath = useFileBrowserStore((state) => state.rootPath);
  const entries = useFileBrowserStore((state) => state.entries);
  const loading = useFileBrowserStore((state) => state.loading);
  const error = useFileBrowserStore((state) => state.error);
  const errorPath = useFileBrowserStore((state) => state.errorPath);
  const searchQuery = useFileBrowserStore((state) => state.searchQuery);
  const searchResults = useFileBrowserStore((state) => state.searchResults);
  const searchIndexing = useFileBrowserStore((state) => state.searchIndexing);
  const searchTruncated = useFileBrowserStore(
    (state) => state.searchTruncated,
  );
  const sortBy = useFileBrowserStore((state) => state.sortBy);
  const sortOrder = useFileBrowserStore((state) => state.sortOrder);
  const selectedPath = useFileBrowserStore((state) => state.selectedPath);
  const recentsCount = useFileBrowserStore((state) => state.recents.length);
  const pinnedCount = useFileBrowserStore((state) => state.pinned.length);
  const viewMode = useFileBrowserStore((state) => state.viewMode);
  const setViewMode = useFileBrowserStore((state) => state.setViewMode);
  const pinLocation = useFileBrowserStore((state) => state.pinLocation);
  const unpinLocation = useFileBrowserStore((state) => state.unpinLocation);
  const isPinned = useFileBrowserStore((state) => state.isPinned);

  // The longest matching root: a folder mounted inside another mounted folder
  // must resolve to itself, or "Unmount selected" removes its parent.
  const selectedRootMount = useMemo(
    () => findOwningRoot(entries, selectedPath),
    [entries, selectedPath],
  );

  const rootNode = useMemo<FileTreeNode | null>(() => {
    if (entries.length === 0) return null;
    if (selectedRootMount) return selectedRootMount;
    // Nothing selected: the root mounted last, not the first one (QA
    // 2026-10-30 F46: the header kept naming the first root).
    return entries[entries.length - 1];
  }, [entries, selectedRootMount]);

  const selectedFileNode = useMemo<FileTreeNode | null>(() => {
    if (!selectedPath) return null;
    const visit = (nodes: FileTreeNode[]): FileTreeNode | null => {
      for (const node of nodes) {
        if (node.path === selectedPath) return node;
        if (node.children) {
          const found = visit(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(entries);
  }, [entries, selectedPath]);

  // Measure the tree container so react-arborist (which needs explicit pixel
  // width/height) fills the panel. We use a *callback ref* rather than a
  // mount-time effect: the tree container only renders once a directory is
  // mounted, so a `useEffect(..., [])` running at panel mount would find a
  // null ref (empty state), bail, and never re-attach — freezing the Tree at
  // its fallback width. The callback ref attaches the ResizeObserver whenever
  // the node appears (and disconnects when it unmounts).
  // Gate the tree's focus ring on keyboard navigation inside the tree (see
  // useKeyboardNavWithin): react-arborist parks DOM focus on a row, which
  // otherwise stays ringed while the user works elsewhere.
  const kbdNavRef = useKeyboardNavWithin();
  const setTreeContainer = useCallback((node: HTMLDivElement | null) => {
    kbdNavRef(node);
    treeContainerRef.current = node;
    treeResizeObserverRef.current?.disconnect();
    treeResizeObserverRef.current = null;
    if (!node) return;

    const measure = () => {
      const r = node.getBoundingClientRect();
      // Ignore zero-size reads (e.g. while the container is display:none for a
      // non-tree view) so we don't clobber the last good measurement.
      if (r.width > 0 && r.height > 0) {
        setTreeSize((prev) =>
          prev.width === r.width && prev.height === r.height
            ? prev
            : { width: r.width, height: r.height },
        );
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    treeResizeObserverRef.current = observer;
  }, [kbdNavRef]);

  // react-arborist renders an unnamed role="tree"; name it "Files".
  useEffect(() => {
    const tree = treeContainerRef.current?.querySelector('[role="tree"]');
    if (tree && tree.getAttribute("aria-label") !== "Files") {
      tree.setAttribute("aria-label", "Files");
    }
  });

  useEffect(
    () => () => {
      treeResizeObserverRef.current?.disconnect();
      treeResizeObserverRef.current = null;
    },
    [],
  );

  // Convert entries to format expected by react-arborist
  const treeData = useMemo(() => {
    const orderMultiplier = sortOrder === "desc" ? -1 : 1;

    const compareByKey = (a: FileTreeNode, b: FileTreeNode): number => {
      // Always group directories before files; within each group apply sortBy.
      const aIsDir = a.type === "directory";
      const bIsDir = b.type === "directory";
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;

      const byName = a.name.localeCompare(b.name);
      if (sortBy === "name") return byName * orderMultiplier;

      // Size/date/type order only the rows that carry the key; rows without
      // it (folders have no size, remote listings may lack dates) sort after
      // them, and ties fall back to name A→Z so a descending key sort never
      // reads as a reversed-name sort.
      let aKey: number | string | undefined;
      let bKey: number | string | undefined;
      switch (sortBy) {
        case "size":
          aKey = aIsDir ? undefined : a.size;
          bKey = bIsDir ? undefined : b.size;
          break;
        case "modified":
          aKey = a.modified ? new Date(a.modified).getTime() : undefined;
          bKey = b.modified ? new Date(b.modified).getTime() : undefined;
          break;
        case "type":
          aKey = a.extension?.toLowerCase();
          bKey = b.extension?.toLowerCase();
          break;
      }
      const aHas = aKey !== undefined && !Number.isNaN(aKey);
      const bHas = bKey !== undefined && !Number.isNaN(bKey);
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas && aKey !== bKey) {
        const primary =
          typeof aKey === "number" && typeof bKey === "number"
            ? aKey - bKey
            : String(aKey).localeCompare(String(bKey));
        return primary * orderMultiplier;
      }
      return byName;
    };

    const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
      [...nodes].sort(compareByKey);

    // react-arborist keys rows by id; a duplicate id (the same folder reached
    // through two mounted roots) paints stale "ghost" rows. Roots use their
    // path; every other row is qualified by its root ("<root>::<path>"), so
    // ids are unique across roots and independent of sort order.
    const convertToTreeData = (
      nodes: FileTreeNode[],
      rootPath: string | null,
    ): FileNodeData[] => {
      return sortNodes(nodes).map((node) => {
        const root = rootPath ?? node.path;
        return {
          id: rootPath === null ? node.path : `${rootPath}::${node.path}`,
          name: node.name,
          path: node.path,
          type: node.type,
          size: node.size,
          extension: node.extension,
          modified: node.modified,
          mountSource: node.mountSource,
          children: node.children
            ? convertToTreeData(node.children, root)
            : undefined,
        };
      });
    };

    // Search filters this same tree (react-arborist `searchTerm`) instead of
    // feeding it a flat result list, which repeated nodes and their children.
    return convertToTreeData(entries, null);
  }, [entries, sortBy, sortOrder]);

  function handleSearchInput(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setSearchInput(value);
    fileBrowserStore.setSearchQuery(value);
  }

  function clearSearch() {
    setSearchInput("");
    fileBrowserStore.clearSearch();
  }

  async function openMountDialog() {
    if (mountActionPending) return;
    setMountActionPending(true);
    setMountActionError(null);
    try {
      await getTransport().invoke<void>("open_mount_dialog");
    } catch (err) {
      console.error("Failed to open mount dialog:", err);
      setMountActionError(
        "Could not open folder picker. Use File > Mount Directory…",
      );
    } finally {
      setMountActionPending(false);
    }
  }

  /** Recents/pinned remember a path: reopen it directly instead of asking again. */
  async function mountKnownLocation(path: string) {
    if (mountActionPending) return;
    setMountActionPending(true);
    setMountActionError(null);
    try {
      await fileBrowserStore.mountDirectory(path);
    } catch (err) {
      console.error("Failed to reopen location:", err);
      setMountActionError(`Could not open ${path}. It may have moved or been deleted.`);
    } finally {
      setMountActionPending(false);
    }
  }

  async function openFileDialog() {
    if (mountActionPending) return;
    setMountActionPending(true);
    setMountActionError(null);
    try {
      await getTransport().invoke<void>("open_file_dialog");
    } catch (err) {
      console.error("Failed to open file dialog:", err);
      setMountActionError("Could not open file picker. Please try again.");
    } finally {
      setMountActionPending(false);
    }
  }

  function openRemoteMountDialog() {
    setMountActionError(null);
    setRemoteDialogOpen(true);
  }

  async function handleRemoteMounted(mount: ConnectedRemoteMount) {
    await mountConnectedRemoteDirectory(mount);
  }

  async function unmountSelectedRoot() {
    if (!selectedRootMount || mountActionPending) return;

    setMountActionPending(true);
    setMountActionError(null);

    try {
      if (
        selectedRootMount.mountSource?.kind === "remote" &&
        selectedRootMount.mountSource.mountId
      ) {
        await getTransport().invoke("remote_mount_unmount", {
          mountId: selectedRootMount.mountSource.mountId,
          purgeCache: false,
        });
      }

      fileBrowserStore.unmountDirectory(selectedRootMount.path);
      if (
        selectedPath &&
        (selectedPath === selectedRootMount.path ||
          selectedPath.startsWith(`${selectedRootMount.path}/`))
      ) {
        fileBrowserStore.selectFile(null);
      }
    } catch (unmountError) {
      console.error("Failed to unmount selected root:", unmountError);
      setMountActionError(
        unmountError instanceof Error
          ? unmountError.message
          : "Failed to unmount selected root.",
      );
    } finally {
      setMountActionPending(false);
    }
  }

  function pinSelectedRoot() {
    if (!selectedRootMount) return;
    pinLocation({
      id: selectedRootMount.path,
      label: selectedRootMount.name,
      path: selectedRootMount.path,
      mountSource: selectedRootMount.mountSource ?? { kind: "local" },
    });
  }

  function unpinSelectedRoot() {
    if (!selectedRootMount) return;
    unpinLocation(selectedRootMount.path);
  }

  function handleNoResultsReset() {
    clearSearch();
    setMountActionError(null);
  }

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isEditable =
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target?.getAttribute("contenteditable") === "true";

    const meta = event.metaKey || event.ctrlKey;

    // ⌘O / Ctrl+O — open mount dialog. Always honored, even from the search box.
    if (meta && (event.key === "o" || event.key === "O")) {
      event.preventDefault();
      void openMountDialog();
      return;
    }

    if (isEditable) return;

    // ⌘⌫ / Ctrl+Backspace — unmount the selected root.
    if (meta && (event.key === "Backspace" || event.key === "Delete")) {
      if (selectedRootMount) {
        event.preventDefault();
        void unmountSelectedRoot();
      }
      return;
    }

    const selectedFile = selectedFileNode;
    if (!selectedFile || selectedFile.type !== "file" || !selectedPath) return;

    // Enter on selected file → default load.
    if (event.key === "Enter") {
      event.preventDefault();
      getEventBus().emit("filebrowser.file.open", {
        path: selectedPath,
        intent: "default" as DisplayOpenIntent,
      });
      return;
    }

    // Space → preview-only. The summary card already renders for the
    // current selection; this just prevents the page from scrolling and
    // re-affirms selection so the probe re-fires.
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      fileBrowserStore.selectFile(selectedPath);
    }
  }

  const hasMountedDirectory = rootPath.trim().length > 0 || entries.length > 0;
  const isSearchActive = searchQuery.trim().length > 0 && hasMountedDirectory;
  const isSearchEmptyState = isSearchActive && searchResults.length === 0;
  const refreshTargetPath = currentPath || rootPath;
  const canRefresh = refreshTargetPath.trim().length > 0;
  const shortcutLabel = useMemo(
    () =>
      navigator.platform.toLowerCase().includes("mac") ? "Cmd+O" : "Ctrl+O",
    [],
  );
  const selectedRootIsPinned = selectedRootMount
    ? isPinned(selectedRootMount.path)
    : false;
  const selectedFolderForSet =
    selectedFileNode?.type === "directory"
      ? selectedFileNode.path
      : null;

  return (
    <div
      className="file-browser-panel"
      onKeyDown={handlePanelKeyDown}
      tabIndex={-1}
    >
      {hasMountedDirectory && (
        <PanelHeader
          title="Files"
          icon={<VscFolder className="h-4 w-4" />}
          hideTitle={true}
          primaryAction={{
            label: "Mount",
            onClick: () => {
              void openMountDialog();
            },
            disabled: mountActionPending,
            title: "Mount directory",
          }}
          overflowActions={[
            {
              id: "mount-local",
              label: "Mount Directory…",
              onClick: () => {
                void openMountDialog();
              },
              disabled: mountActionPending,
            },
            {
              id: "mount-remote",
              label: "Mount Remote (SSH)…",
              onClick: openRemoteMountDialog,
              disabled: mountActionPending,
            },
            {
              id: "unmount-selected",
              label: "Unmount selected",
              onClick: () => {
                void unmountSelectedRoot();
              },
              disabled: mountActionPending || !selectedRootMount,
              danger: true,
            },
            {
              id: "pin-selected",
              label: selectedRootIsPinned ? "Unpin Selected" : "Pin Selected",
              onClick: () => {
                if (selectedRootIsPinned) unpinSelectedRoot();
                else pinSelectedRoot();
              },
              disabled: !selectedRootMount,
            },
            {
              id: "open-folder-image-set",
              label: "Open as switchable layer…",
              onClick: () => {
                if (selectedFolderForSet) void getImageSetService().openFolder(selectedFolderForSet);
              },
              disabled: !selectedFolderForSet,
            },
            {
              id: "create-set-from-folder",
              label: "Open in Set studio…",
              onClick: () => {
                if (!selectedFolderForSet) return;
                void getSetStudioService().openFolderOntologyInStudio({
                  discoveryRoot: selectedFolderForSet,
                });
              },
              disabled: !selectedFolderForSet,
            },
            {
              id: "open-file",
              label: "Open File…",
              onClick: () => {
                void openFileDialog();
              },
              disabled: mountActionPending,
            },
            {
              id: "refresh",
              label: "Refresh directory",
              onClick: () => {
                if (!canRefresh) return;
                void fileBrowserStore.refreshDirectory(refreshTargetPath);
              },
              disabled: mountActionPending || !canRefresh,
            },
            {
              id: "clear-search",
              label: "Clear search",
              onClick: handleNoResultsReset,
              disabled: searchQuery.trim().length === 0,
            },
          ]}
        />
      )}

      {hasMountedDirectory && (
        <SourceHeader rootNode={rootNode} selectedPath={selectedPath} />
      )}

      {hasMountedDirectory && (
        <ViewModeTabs value={viewMode} onChange={setViewMode} />
      )}

      {hasMountedDirectory && viewMode === "tree" && (
        <FilterBar
          searchInput={searchInput}
          searchQuery={searchQuery}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSearchChange={handleSearchInput}
          onClearSearch={clearSearch}
          onSortByChange={(value) => fileBrowserStore.setSortBy(value)}
          onToggleSortOrder={() =>
            fileBrowserStore.setSortOrder(sortOrder === "asc" ? "desc" : "asc")
          }
        />
      )}

      {viewMode === "tree" &&
        isSearchActive &&
        searchTruncated &&
        !isSearchEmptyState && (
          <p className="fb-search-partial" role="status">
            Searched in part: very deep or very large folders were skipped.
            Open a folder to search inside it.
          </p>
        )}

      {mountActionError && hasMountedDirectory && (
        <Notice severity="danger" className="fb-inline-error">
          {mountActionError}
        </Notice>
      )}

      <div className="tree-container">
        {loading && treeData.length === 0 ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span className="loading-text">Loading directory...</span>
          </div>
        ) : error ? (
          <div className="error-state">
            <Notice
              severity="danger"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void fileBrowserStore.refreshDirectory(
                      errorPath ?? (currentPath || rootPath),
                    )
                  }
                >
                  Retry
                </Button>
              }
            >
              <div className="font-medium">Error loading directory</div>
              <div className="error-message">{error}</div>
            </Notice>
          </div>
        ) : !hasMountedDirectory ? (
          <FilesStartPanel
            shortcutLabel={shortcutLabel}
            pending={mountActionPending}
            errorMessage={mountActionError}
            onMountLocal={(path) => {
              void (path ? mountKnownLocation(path) : openMountDialog());
            }}
            onMountRemote={openRemoteMountDialog}
            onOpenFile={() => {
              void openFileDialog();
            }}
          />
        ) : (
          <>
            {/*
              Tree is always rendered while a directory is mounted, even when
              another view (Images / Loaded / BIDS) is active, because
              react-arborist creates an internal HTML5 DnD backend on mount
              and tearing it down across tab switches races the next mount,
              throwing "Cannot have two HTML5 backends at the same time."
              Keeping the Tree mounted under display: none preserves the
              backend across tab switches.
            */}
            <div
              ref={setTreeContainer}
              onKeyDownCapture={handleTreeTabCapture}
              {...filesViewPanelProps("tree")}
              className="fb-tree-container"
              style={{
                width: "100%",
                height: "100%",
                position: "relative",
                display: viewMode === "tree" ? "block" : "none",
              }}
            >
              {/*
                The no-match card sits over the tree instead of replacing
                it: an unmounted tree forgets which folders were open.
              */}
              {isSearchEmptyState ? (
                <div className="empty-state fb-search-empty" data-testid="files-search-empty">
                  <div className="empty-state-card" role="status">
                    <p className="empty-state-kicker">
                      {searchIndexing ? "Searching folders…" : "No matching files"}
                    </p>
                    <p className="empty-state-message">
                      {searchIndexing
                        ? "Listing folders that have not been opened yet."
                        : searchTruncated
                          ? "Searched in part: no match in the folders searched. Very deep or very large folders were skipped; open a folder to search inside it."
                          : "No neuroimaging files match your current search. Reset search or mount another folder."}
                    </p>
                    <div className="empty-state-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleNoResultsReset}
                      >
                        Clear search
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              {(treeSize.width > 0 && treeSize.height > 0) ||
                treeData.length > 0 ? (
                <Tree
                  key={`tree-v2-${entries.length}`}
                  ref={treeApiRef}
                  data={treeData}
                  openByDefault={false}
                  initialOpenState={Object.fromEntries(
                    [...openFolderIdsRef.current].map((id) => [id, true]),
                  )}
                  onToggle={handleTreeToggle}
                  width={treeSize.width || 300}
                  height={treeSize.height || 400}
                  indent={12}
                  rowHeight={24}
                  overscanCount={5}
                  className="react-arborist"
                  renderRow={FileTreeItemRow}
                  searchTerm={isSearchActive ? searchQuery : undefined}
                  searchMatch={(node, term) =>
                    nodeMatchesQuery(node.data.name, term)
                  }
                  onActivate={(node) => {
                    fileBrowserStore.selectFile(node.data.path);
                    if (node.isInternal) {
                      const wasOpen = node.isOpen;
                      node.toggle();
                      if (
                        !wasOpen &&
                        (!node.data.children || node.data.children.length === 0)
                      ) {
                        fileBrowserStore.loadDirectory(node.data.path);
                      }
                    }
                  }}
                  disableMultiSelection={true}
                  disableEdit={true}
                  disableDrag={true}
                  disableDrop={true}
                >
                  {FileTreeRow}
                </Tree>
              ) : (
                <div
                  style={{ padding: "20px", color: "var(--app-text-muted)" }}
                >
                  Initializing file browser…
                </div>
              )}
            </div>
            {viewMode !== "tree" && (
              <div {...filesViewPanelProps(viewMode)} className="fb-view-panel">
                {viewMode === "images" ? (
                  <ImagesView rootNode={rootNode} selectedPath={selectedPath} />
                ) : viewMode === "loaded" ? (
                  <LoadedView />
                ) : (
                  <BidsView rootNode={rootNode} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {hasMountedDirectory &&
        selectedFileNode &&
        selectedFileNode.type === "file" && (
          <SelectedFileSummary
            selectedPath={selectedPath}
            selectedNode={{
              name: selectedFileNode.name,
              type: selectedFileNode.type,
              size: selectedFileNode.size,
            }}
          />
        )}

      {hasMountedDirectory && (
        <FilesFooterStatus
          rootNode={rootNode}
          recentsCount={recentsCount}
          pinnedCount={pinnedCount}
        />
      )}

      <RemoteMountDialog
        isOpen={remoteDialogOpen}
        onClose={() => {
          setRemoteDialogOpen(false);
        }}
        onMounted={handleRemoteMounted}
      />
    </div>
  );
};

export const FileBrowserPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="FileBrowserPanel">
      <FileBrowserPanelContent />
    </PanelErrorBoundary>
  );
};
