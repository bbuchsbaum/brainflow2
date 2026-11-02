/**
 * File Browser Store - Manages file system navigation and state
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { subscribeWithSelector } from "zustand/middleware";
import { enableMapSet } from "immer";
import type {
  FileBrowserState,
  FileTreeNode,
  MountSource,
} from "@/types/filesystem";
import type { FileNode } from "@/services/filesystem/FilesystemService";
import { getEventBus } from "@/events/EventBus";
import { getApiService } from "@/services/apiService";
import { formatTauriError } from "@/utils/formatTauriError";
import {
  LOCAL_SEARCH_LIMITS,
  REMOTE_SEARCH_LIMITS,
  collectSearchMatches,
  nextDirectoriesToIndex,
} from "./fileBrowserSearch";

// Enable Map and Set support in Immer
enableMapSet();

// Declare global interface for store
declare global {
  interface Window {
    __fileBrowserStore?: ReturnType<typeof createFileBrowserStore>;
  }
}

const PERSIST_KEY = "bf.fileBrowser.v1";
const PERSIST_VERSION = 1;
const RECENTS_LIMIT = 10;
const PINNED_LIMIT = 12;

export interface RecentLocation {
  /** Path of the mounted root or opened file. */
  path: string;
  /** Display name (basename or remote label). */
  displayName: string;
  /** Mount metadata so we can re-mount or recolor the row. */
  mountSource: MountSource;
  /** Epoch ms of the most recent open. */
  lastOpened: number;
  /** Either 'mount' (a directory mount) or 'file' (a single opened file). */
  kind: "mount" | "file";
}

export interface PinnedLocation {
  /** Stable id (currently the path). */
  id: string;
  /** User-visible label; defaults to basename. */
  label: string;
  /** Path to mount or open. */
  path: string;
  /** Mount metadata so we can re-mount or rehydrate context. */
  mountSource: MountSource;
}

export type FilesViewMode = "tree" | "bids" | "images" | "loaded";

const VIEW_MODES: readonly FilesViewMode[] = [
  "tree",
  "bids",
  "images",
  "loaded",
] as const;

function isViewMode(value: unknown): value is FilesViewMode {
  return (
    typeof value === "string" &&
    (VIEW_MODES as readonly string[]).includes(value)
  );
}

interface PersistedShape {
  v: number;
  recents: RecentLocation[];
  pinned: PinnedLocation[];
  fourD: string[];
  viewMode?: FilesViewMode;
}

function loadPersisted(): PersistedShape {
  if (typeof window === "undefined") {
    return {
      v: PERSIST_VERSION,
      recents: [],
      pinned: [],
      fourD: [],
      viewMode: "tree",
    };
  }
  try {
    const raw = window.localStorage?.getItem(PERSIST_KEY);
    if (!raw)
      return {
        v: PERSIST_VERSION,
        recents: [],
        pinned: [],
        fourD: [],
        viewMode: "tree",
      };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || parsed.v !== PERSIST_VERSION) {
      return {
        v: PERSIST_VERSION,
        recents: [],
        pinned: [],
        fourD: [],
        viewMode: "tree",
      };
    }
    return {
      v: PERSIST_VERSION,
      recents: Array.isArray(parsed.recents)
        ? parsed.recents.slice(0, RECENTS_LIMIT)
        : [],
      pinned: Array.isArray(parsed.pinned)
        ? parsed.pinned.slice(0, PINNED_LIMIT)
        : [],
      fourD: Array.isArray(parsed.fourD) ? parsed.fourD : [],
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : "tree",
    };
  } catch (error) {
    console.warn("fileBrowserStore: failed to load persisted state", error);
    return {
      v: PERSIST_VERSION,
      recents: [],
      pinned: [],
      fourD: [],
      viewMode: "tree",
    };
  }
}

function persist(state: {
  recents: RecentLocation[];
  pinned: PinnedLocation[];
  fourDPaths: Set<string>;
  viewMode: FilesViewMode;
}) {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = {
      v: PERSIST_VERSION,
      recents: state.recents,
      pinned: state.pinned,
      fourD: Array.from(state.fourDPaths),
      viewMode: state.viewMode,
    };
    window.localStorage?.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("fileBrowserStore: failed to persist state", error);
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

interface FileBrowserActions {
  // Mount operations
  /** The last explicit mount or Recents click, already mounted or not. */
  lastMount: { path: string; nonce: number; remote: boolean } | null;
  mountDirectory: (
    path: string,
    options?: { displayName?: string; mountSource?: MountSource },
  ) => Promise<void>;
  unmountDirectory: (path: string) => void;

  // Navigation
  setCurrentPath: (path: string) => void;
  setRootPath: (path: string) => void;
  navigateToParent: () => void;

  // Tree operations
  loadDirectory: (path: string) => Promise<void>;
  /** Background, best-effort listing of a collapsed folder (e.g. on hover). */
  prefetchDirectory: (path: string) => void;
  expandPath: (path: string) => void;
  collapsePath: (path: string) => void;
  toggleExpanded: (path: string) => void;
  refreshDirectory: (path?: string) => Promise<void>;

  // Selection
  selectFile: (path: string | null) => void;

  // Search
  setSearchQuery: (query: string) => void;
  performSearch: () => void;
  /** List collapsed folders (bounded) so the active search can match them. */
  indexForSearch: () => Promise<void>;
  clearSearch: () => void;

  // View options
  setShowHidden: (show: boolean) => void;
  setSortBy: (sortBy: FileBrowserState["sortBy"]) => void;
  setSortOrder: (order: FileBrowserState["sortOrder"]) => void;

  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Utilities
  getFileTypeInfo: (path: string) => { icon: string; color: string } | null;
  isNeuroimagingFile: (path: string) => boolean;
  flattenTree: () => FileTreeNode[];

  // Recents / Pinned / 4D flags
  recordOpenedFile: (
    path: string,
    options?: { displayName?: string; mountSource?: MountSource },
  ) => void;
  clearRecents: () => void;
  pinLocation: (location: PinnedLocation) => void;
  unpinLocation: (id: string) => void;
  isPinned: (path: string) => boolean;
  markFourD: (path: string, isFourD?: boolean) => void;
  setViewMode: (mode: FilesViewMode) => void;
}

interface FileBrowserStateExtras {
  /** Folder whose listing produced `error`, so Retry lists that folder again. */
  errorPath: string | null;
  /** True while the search lists collapsed folders in the background. */
  searchIndexing: boolean;
  /** True when the search stopped at its depth/listing limits. */
  searchTruncated: boolean;
  recents: RecentLocation[];
  pinned: PinnedLocation[];
  fourDPaths: Set<string>;
  viewMode: FilesViewMode;
}

interface FileBrowserStore
  extends FileBrowserState,
    FileBrowserStateExtras,
    FileBrowserActions {}

// Neuroimaging file extensions we surface in the tree.
const NEUROIMAGING_EXTENSIONS = [
  ".nii",
  ".nii.gz",
  ".gii",
  ".surf.gii",
  ".func.gii",
];

// Hover-prefetch is intentionally SINGLE-FLIGHT: at most one background
// listing runs at a time across the whole tree, and never while a
// user-initiated load is in progress. Firing a remote (SFTP) listing per
// hovered folder can open many concurrent SSH channels and exhaust the
// server's channel limit ("Failed to open channel (ConnectFailed)"), so we
// cap prefetch concurrency to one rather than letting hovers storm the link.
let prefetchBusy = false;

/** Convert a raw `fs_list_directory` response into tree children. */
function convertApiNodesToTreeChildren(
  files: FileNode[],
  depth: number,
): FileTreeNode[] {
  return files
    .filter((file) => {
      if (file.isDir) return true;
      const fileName = file.name.toLowerCase();
      return NEUROIMAGING_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    })
    .map(
      (file) =>
        ({
          id: file.id,
          name: file.name,
          path: file.id, // API returns full path as id
          type: file.isDir ? "directory" : "file",
          depth,
          expanded: false,
          children: file.isDir ? [] : undefined,
          size: !file.isDir && typeof file.size === "number" ? file.size : undefined,
          extension: !file.isDir ? file.name.match(/\.[^.]+$/)?.[0] : undefined,
          modified:
            typeof file.modifiedMs === "number"
              ? new Date(file.modifiedMs)
              : undefined,
        }) as FileTreeNode,
    );
}

// Search crawl pacing: how long a pass waits for a user load or the remote
// single-flight slot, and how many such waits end the crawl as partial.
const SEARCH_WAIT_MS = 100;
const SEARCH_MAX_WAITS = 300;

class ListingTimeoutError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ListingTimeoutError(`Listing took longer than ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Depth-first search for a node by its path. */
function findNodeByPath(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

// Create store only once and attach to window for cross-root sharing
const createFileBrowserStore = () => {
  const persisted = loadPersisted();
  let nextRequest = 0;
  const requests = new Map<string, number>();
  const beginRequest = (path: string) => {
    const id = ++nextRequest;
    requests.set(path, id);
    return id;
  };
  const invalidate = (root: string) => {
    for (const path of requests.keys()) {
      if (path === root || path.startsWith(`${root.replace(/\/$/, '')}/`)) requests.delete(path);
    }
  };
  // Folders whose children are known (listed, possibly empty). An unlisted
  // folder and an empty one both carry `children: []`, so the search crawl
  // needs this to tell them apart.
  const listed = new Set<string>();
  const forgetListed = (root: string) => {
    const base = root.replace(/\/$/, "");
    for (const path of listed) {
      if (path === root || path.startsWith(`${base}/`)) listed.delete(path);
    }
  };
  // Search crawl: one session per search (cleared by clearSearch). Each
  // session has a per-root listing budget; bumping `searchSession` stops the
  // crawl between listings.
  let searchSession = 0;
  let crawlRunning = false;
  const searchBudget = new Map<string, number>();
  // Folders whose listing failed or timed out during this search, and remote
  // roots whose listing timed out; both cleared with the search.
  const searchFailed = new Set<string>();
  const stalledRoots = new Set<string>();

  return create<FileBrowserStore>()(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        currentPath: "",
        rootPath: "",
        entries: [],
        lastMount: null,
        errorPath: null,
        searchIndexing: false,
        searchTruncated: false,
        expandedPaths: new Set(),
        loadingPaths: new Set(),
        selectedPath: null,
        loading: false,
        error: null,
        searchQuery: "",
        searchResults: [],
        showHidden: false,
        sortBy: "name",
        sortOrder: "asc",
        recents: persisted.recents,
        pinned: persisted.pinned,
        fourDPaths: new Set<string>(persisted.fourD),
        viewMode: persisted.viewMode ?? "tree",

        // Mount operations
        mountDirectory: async (path, options) => {
          // Extract directory name from path
          const dirName = options?.displayName || path.split("/").pop() || path;
          const remote = options?.mountSource?.kind === "remote";
          set((state) => {
            state.lastMount = { path, nonce: (state.lastMount?.nonce ?? 0) + 1, remote };
          });

          // Create a root node for the mounted directory
          const mountedNode: FileTreeNode = {
            id: path,
            name: dirName,
            path: path,
            type: "directory",
            depth: 0,
            expanded: false,
            children: [],
            modified: new Date(),
            mountSource: options?.mountSource ?? { kind: "local" },
          };

          // Add the mount node to state
          set((state) => {
            // Add to entries if not already mounted
            if (!state.entries.find((e) => e.path === path)) {
              forgetListed(path);
              state.entries.push(mountedNode);
              console.log("Mounted directory node added:", mountedNode);
            }
          });

          // Record in recents (LRU<=10) — dedupe by path, push to front.
          set((state) => {
            const filtered = state.recents.filter((r) => r.path !== path);
            const entry: RecentLocation = {
              path,
              displayName: dirName,
              mountSource: options?.mountSource ?? { kind: "local" },
              lastOpened: Date.now(),
              kind: "mount",
            };
            state.recents = [entry, ...filtered].slice(0, RECENTS_LIMIT);
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });

          // Use queueMicrotask to ensure state is committed before loading
          await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

          // Verify the node exists before loading
          const currentEntries = get().entries;
          console.log(
            "Entries after mount:",
            currentEntries.map((e) => e.path),
          );

          // Load the directory contents
          await get().loadDirectory(path);
        },

        unmountDirectory: (path) => {
          invalidate(path);
          forgetListed(path);
          set((state) => {
            state.entries = state.entries.filter((e) => e.path !== path);
            // Also remove from expanded paths
            for (const entry of state.expandedPaths) {
              if (entry === path || entry.startsWith(`${path}/`)) state.expandedPaths.delete(entry);
            }
            for (const entry of state.loadingPaths) {
              if (entry === path || entry.startsWith(`${path}/`)) state.loadingPaths.delete(entry);
            }
            state.loading = state.loadingPaths.size > 0;
          });
        },

        // Navigation
        setCurrentPath: (path) => {
          set((state) => {
            state.currentPath = path;
          });
        },

        setRootPath: (path) => {
          requests.clear();
          listed.clear();
          set((state) => {
            state.rootPath = path;
            state.currentPath = path;
            state.entries = []; // Clear entries, will be loaded by loadDirectory
            state.expandedPaths.clear();
            state.loadingPaths.clear();
            state.loading = false;
            state.selectedPath = null;
          });
        },

        navigateToParent: () => {
          const current = get().currentPath;
          const parent = current.split("/").slice(0, -1).join("/") || "/";
          get().setCurrentPath(parent);
        },

        // Tree operations
        loadDirectory: async (path) => {
          const request = beginRequest(path);
          set((state) => {
            state.loading = true;
            state.error = null;
            state.errorPath = null;
            // Per-row feedback: mark THIS folder as loading its children so the
            // tree can show a spinner during slow (remote) expansions.
            state.loadingPaths.add(path);
          });

          try {
            const apiService = getApiService();
            const files = await apiService.listDirectory(path, 1);
            if (requests.get(path) !== request) return;
            listed.add(path);

            set((state) => {
              const node = findNodeByPath(state.entries, path);
              if (node) {
                node.children = convertApiNodesToTreeChildren(
                  files,
                  node.depth + 1,
                );
                node.loading = false;
                node.expanded = true; // Auto-expand when loaded
              } else {
                console.warn("Could not find node to update for path:", path);
              }

              state.loadingPaths.delete(path);
              state.loading = state.loadingPaths.size > 0;
            });

            const eventBus = getEventBus();
            eventBus.emit("filebrowser.directory.loaded", { path });
          } catch (error) {
            if (requests.get(path) !== request) return;
            console.error("Error loading directory:", error);
            set((state) => {
              state.loadingPaths.delete(path);
              state.loading = state.loadingPaths.size > 0;
              state.error =
                formatTauriError(error) || "Failed to load directory";
              state.errorPath = path;
            });
          }
        },

        // Background prefetch of a collapsed folder's children (e.g. on hover),
        // so the subsequent expand is instant. Deliberately silent and gentle:
        // it never touches the global `loading` flag or auto-expands the node,
        // runs at most ONE at a time (`prefetchBusy`), never overlaps a
        // user-initiated load, and skips folders that are already loaded. The
        // single-flight guard is what keeps remote (SSH/SFTP) browsing from
        // opening a flood of concurrent channels.
        prefetchDirectory: (path) => {
          if (prefetchBusy) return; // one background listing at a time
          if (get().loading) return; // never overlap a real load
          const existing = findNodeByPath(get().entries, path);
          if (existing && existing.children && existing.children.length > 0) {
            return; // already loaded
          }
          const request = beginRequest(path);
          prefetchBusy = true;
          void (async () => {
            try {
              const files = await getApiService().listDirectory(path, 1);
              if (requests.get(path) !== request) return;
              listed.add(path);
              set((state) => {
                const node = findNodeByPath(state.entries, path);
                if (node && (!node.children || node.children.length === 0)) {
                  node.children = convertApiNodesToTreeChildren(
                    files,
                    node.depth + 1,
                  );
                }
              });
            } catch {
              // Best-effort prefetch — swallow errors; a real expand will retry.
            } finally {
              prefetchBusy = false;
            }
          })();
        },

        expandPath: (path) => {
          set((state) => {
            state.expandedPaths.add(path);
          });

          // Load directory if not already loaded
          const findNode = (nodes: FileTreeNode[]): FileTreeNode | null => {
            for (const node of nodes) {
              if (node.path === path) return node;
              if (node.children) {
                const found = findNode(node.children);
                if (found) return found;
              }
            }
            return null;
          };

          const node = findNode(get().entries);
          if (
            node &&
            node.type === "directory" &&
            (!node.children || node.children.length === 0)
          ) {
            get().loadDirectory(path);
          }
        },

        collapsePath: (path) => {
          invalidate(path);
          set((state) => {
            state.expandedPaths.delete(path);
            const node = findNodeByPath(state.entries, path);
            if (node) node.expanded = false;
            for (const entry of state.loadingPaths) {
              if (entry === path || entry.startsWith(`${path}/`)) state.loadingPaths.delete(entry);
            }
            state.loading = state.loadingPaths.size > 0;
          });
        },

        toggleExpanded: (path) => {
          const isExpanded = get().expandedPaths.has(path);
          if (isExpanded) {
            get().collapsePath(path);
          } else {
            get().expandPath(path);
          }
        },

        refreshDirectory: async (path) => {
          const targetPath =
            path || get().errorPath || get().currentPath || get().rootPath;
          if (!targetPath) return;
          forgetListed(targetPath);
          set((state) => {
            // Clear children for the target path
            const clearChildren = (nodes: FileTreeNode[]) => {
              for (const node of nodes) {
                if (node.path === targetPath) {
                  node.children = undefined;
                  node.loading = false;
                } else if (node.children) {
                  clearChildren(node.children);
                }
              }
            };
            clearChildren(state.entries);
          });

          await get().loadDirectory(targetPath);
        },

        // Selection
        selectFile: (path) => {
          set((state) => {
            state.selectedPath = path;
          });

          if (path) {
            const eventBus = getEventBus();
            eventBus.emit("filebrowser.file.selected", { path });
          }
        },

        // Search
        setSearchQuery: (query) => {
          set((state) => {
            state.searchQuery = query;
          });

          if (query.trim()) {
            get().performSearch();
          } else {
            get().clearSearch();
          }
        },

        performSearch: () => {
          const query = get().searchQuery;
          if (!query.trim()) return;
          const results = collectSearchMatches(get().entries, query);
          set((state) => {
            state.searchResults = results;
            // A crawl already in flight (e.g. one started before the search
            // was cleared and retyped) is still indexing for this search.
            if (crawlRunning) state.searchIndexing = true;
          });
          if (!crawlRunning) void get().indexForSearch();
        },

        // Bounded background listing of collapsed folders so a search finds
        // matches that were never expanded. Local folders are listed a few at
        // a time; remote folders ONE at a time, sharing prefetch's
        // single-flight guard (concurrent SFTP channels exhaust the server).
        // Passes wait while a user-initiated load runs. Each listing has a
        // timeout; failures and timeouts are skipped for the rest of this
        // search, and a remote root whose listing timed out is not crawled
        // further. Stops when the search is cleared, at each root's
        // depth/listing budget, or when every reachable folder is listed.
        indexForSearch: async () => {
          if (crawlRunning) return;
          crawlRunning = true;
          const session = searchSession;
          set((state) => {
            state.searchIndexing = true;
          });
          let truncated = false;
          let waits = 0;
          const known = { has: (path: string) => listed.has(path) || searchFailed.has(path) };
          try {
            while (session === searchSession && get().searchQuery.trim()) {
              if (get().loading) {
                if (++waits > SEARCH_MAX_WAITS) {
                  truncated = true;
                  break;
                }
                await delay(SEARCH_WAIT_MS);
                continue;
              }
              const { entries, loadingPaths } = get();
              const batch: Array<{ path: string; root: string; remote: boolean }> = [];
              const taken = new Set<string>();
              let localSlots = 4;
              let remoteSlots = prefetchBusy ? 0 : 1;
              let remoteWaiting = false;
              truncated = false;
              for (const root of entries) {
                const remote = root.mountSource?.kind === "remote";
                const limits = remote ? REMOTE_SEARCH_LIMITS : LOCAL_SEARCH_LIMITS;
                const used = searchBudget.get(root.path) ?? 0;
                const remaining = limits.maxListings - used;
                const { paths, depthLimited } = nextDirectoriesToIndex(
                  root,
                  known,
                  limits.maxDepth,
                  4 + loadingPaths.size + taken.size,
                );
                if (depthLimited) truncated = true;
                const candidates = paths.filter((p) => !loadingPaths.has(p) && !taken.has(p));
                if (candidates.length === 0) continue;
                if (remaining <= 0 || stalledRoots.has(root.path)) {
                  truncated = true;
                  continue;
                }
                const slots = remote ? remoteSlots : localSlots;
                if (slots <= 0) {
                  if (remote) remoteWaiting = true;
                  continue;
                }
                const picked = candidates.slice(0, Math.min(slots, remaining));
                if (remote) remoteSlots -= picked.length;
                else localSlots -= picked.length;
                searchBudget.set(root.path, used + picked.length);
                for (const path of picked) {
                  taken.add(path);
                  batch.push({ path, root: root.path, remote });
                }
              }
              if (batch.length === 0) {
                if (!remoteWaiting) break;
                // Only a remote folder is left and another remote listing
                // (hover prefetch) holds the single-flight slot.
                if (++waits > SEARCH_MAX_WAITS) {
                  truncated = true;
                  break;
                }
                await delay(SEARCH_WAIT_MS);
                continue;
              }
              waits = 0;

              await Promise.all(
                batch.map(async ({ path, root, remote }) => {
                  const limits = remote ? REMOTE_SEARCH_LIMITS : LOCAL_SEARCH_LIMITS;
                  const request = beginRequest(path);
                  const listing = getApiService().listDirectory(path, 1);
                  if (remote) {
                    // Hold the single-flight slot until the listing really
                    // settles, even past our timeout.
                    prefetchBusy = true;
                    void listing.then(
                      () => { prefetchBusy = false; },
                      () => { prefetchBusy = false; },
                    );
                  }
                  try {
                    const files = await withTimeout(listing, limits.listingTimeoutMs);
                    if (requests.get(path) !== request) return;
                    listed.add(path);
                    set((state) => {
                      const node = findNodeByPath(state.entries, path);
                      if (node && (!node.children || node.children.length === 0)) {
                        node.children = convertApiNodesToTreeChildren(
                          files,
                          node.depth + 1,
                        );
                      }
                    });
                  } catch (error) {
                    // Unreadable or slow folder: skip it for this search only
                    // (cleared with the search, so a later search retries it).
                    searchFailed.add(path);
                    if (remote && error instanceof ListingTimeoutError) {
                      stalledRoots.add(root);
                    }
                  }
                }),
              );

              const query = get().searchQuery;
              if (session === searchSession && query.trim()) {
                const results = collectSearchMatches(get().entries, query);
                set((state) => {
                  state.searchResults = results;
                });
              }
            }
          } finally {
            crawlRunning = false;
            if (session === searchSession) {
              set((state) => {
                state.searchIndexing = false;
                state.searchTruncated = truncated;
              });
            } else if (get().searchQuery.trim()) {
              // The search was cleared and restarted while a listing was in
              // flight: crawl for the new session.
              void get().indexForSearch();
            }
          }
        },

        clearSearch: () => {
          searchSession += 1;
          searchBudget.clear();
          searchFailed.clear();
          stalledRoots.clear();
          set((state) => {
            state.searchQuery = "";
            state.searchResults = [];
            state.searchIndexing = false;
            state.searchTruncated = false;
          });
        },

        // View options
        setShowHidden: (show) => {
          set((state) => {
            state.showHidden = show;
          });
        },

        setSortBy: (sortBy) => {
          set((state) => {
            state.sortBy = sortBy;
          });
        },

        setSortOrder: (order) => {
          set((state) => {
            state.sortOrder = order;
          });
        },

        // State management
        setLoading: (loading) => {
          set((state) => {
            state.loading = loading;
          });
        },

        setError: (error) => {
          set((state) => {
            state.error = error;
          });
        },

        // Utilities
        getFileTypeInfo: (path) => {
          const extension = path.split(".").pop()?.toLowerCase();
          if (!extension) return null;

          // Check for neuroimaging file types
          if (extension === "gz") {
            const fullExt = path.match(/\.([^.]+\.gz)$/)?.[1];
            if (fullExt === "nii.gz") {
              return { icon: "🧠", color: "#3b82f6" };
            }
          }

          const fileTypeMap: Record<string, { icon: string; color: string }> = {
            nii: { icon: "🧠", color: "#3b82f6" },
            gii: { icon: "🌐", color: "#10b981" },
            json: { icon: "📄", color: "#6b7280" },
            tsv: { icon: "📊", color: "#6b7280" },
            csv: { icon: "📊", color: "#6b7280" },
            txt: { icon: "📝", color: "#6b7280" },
            md: { icon: "📖", color: "#6b7280" },
            img: { icon: "📊", color: "#f59e0b" },
            hdr: { icon: "📊", color: "#f59e0b" },
            dcm: { icon: "🏥", color: "#ef4444" },
            mgz: { icon: "🎭", color: "#8b5cf6" },
            mgh: { icon: "🎭", color: "#8b5cf6" },
          };

          return fileTypeMap[extension] || { icon: "📄", color: "#6b7280" };
        },

        isNeuroimagingFile: (path) => {
          const neuroimagingExts = [
            ".nii",
            ".nii.gz",
            ".gii",
            ".surf.gii",
            ".func.gii",
            ".img",
            ".hdr",
            ".dcm",
            ".dicom",
            ".mgz",
            ".mgh",
          ];

          return neuroimagingExts.some((ext) =>
            path.toLowerCase().endsWith(ext),
          );
        },

        flattenTree: () => {
          const flatten = (
            nodes: FileTreeNode[],
            result: FileTreeNode[] = [],
          ): FileTreeNode[] => {
            for (const node of nodes) {
              result.push(node);
              if (node.expanded && node.children) {
                flatten(node.children, result);
              }
            }
            return result;
          };

          const { entries, searchQuery, searchResults } = get();
          return searchQuery ? searchResults : flatten(entries);
        },

        // Recents / Pinned / 4D flags
        recordOpenedFile: (path, options) => {
          if (!path) return;
          set((state) => {
            const filtered = state.recents.filter((r) => r.path !== path);
            const entry: RecentLocation = {
              path,
              displayName: options?.displayName ?? basename(path) ?? path,
              mountSource: options?.mountSource ?? { kind: "local" },
              lastOpened: Date.now(),
              kind: "file",
            };
            state.recents = [entry, ...filtered].slice(0, RECENTS_LIMIT);
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },

        clearRecents: () => {
          set((state) => {
            state.recents = [];
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },

        pinLocation: (location) => {
          if (!location?.path) return;
          set((state) => {
            if (state.pinned.some((p) => p.id === location.id)) return;
            state.pinned = [...state.pinned, location].slice(0, PINNED_LIMIT);
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },

        unpinLocation: (id) => {
          set((state) => {
            const next = state.pinned.filter((p) => p.id !== id);
            if (next.length === state.pinned.length) return;
            state.pinned = next;
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },

        isPinned: (path) => {
          return get().pinned.some((p) => p.path === path);
        },

        markFourD: (path, isFourD = true) => {
          if (!path) return;
          set((state) => {
            const has = state.fourDPaths.has(path);
            if (isFourD === has) return;
            if (isFourD) {
              state.fourDPaths.add(path);
            } else {
              state.fourDPaths.delete(path);
            }
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },

        setViewMode: (mode) => {
          if (!isViewMode(mode)) return;
          set((state) => {
            if (state.viewMode === mode) return;
            state.viewMode = mode;
            persist({
              recents: state.recents,
              pinned: state.pinned,
              fourDPaths: state.fourDPaths,
              viewMode: state.viewMode,
            });
          });
        },
      })),
    ),
  );
};

// Export store with global instance sharing
export const useFileBrowserStore: ReturnType<typeof createFileBrowserStore> =
  (() => {
    if (typeof window !== "undefined" && window.__fileBrowserStore) {
      console.log("Using existing fileBrowserStore from window");
      return window.__fileBrowserStore;
    }

    console.log("Creating new fileBrowserStore instance");
    const store = createFileBrowserStore();

    if (typeof window !== "undefined") {
      window.__fileBrowserStore = store;
      console.log("Attached fileBrowserStore to window");
    }

    return store;
  })();

// Subscribe to relevant events
const eventBus = getEventBus();

eventBus.on("filebrowser.file.selected", ({ path }) => {
  console.log("File selected:", path);
});

eventBus.on("filebrowser.directory.loaded", ({ path }) => {
  console.log("Directory loaded:", path);
});
