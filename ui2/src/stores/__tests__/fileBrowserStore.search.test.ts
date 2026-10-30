import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTreeNode } from '@/types/filesystem';

const listDirectory = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ listDirectory }),
}));

import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  LOCAL_SEARCH_LIMITS,
  collectSearchMatches,
  findOwningRoot,
  nextDirectoriesToIndex,
} from '@/stores/fileBrowserSearch';

interface ApiNode {
  id: string;
  name: string;
  isDir: boolean;
  parentIdx: null;
  iconId: number;
}

/** A fake disk: directory path → entries. */
function fakeDisk(layout: Record<string, Array<[name: string, isDir: boolean]>>) {
  return (path: string): Promise<ApiNode[]> => {
    const entries = layout[path];
    if (!entries) return Promise.reject(new Error(`Directory '${path}' does not exist`));
    return Promise.resolve(
      entries.map(([name, isDir]) => ({
        id: `${path}/${name}`,
        name,
        isDir,
        parentIdx: null,
        iconId: 0,
      })),
    );
  };
}

function root(path: string, kind: 'local' | 'remote' = 'local'): FileTreeNode {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    type: 'directory',
    depth: 0,
    expanded: false,
    children: [],
    mountSource: { kind },
  };
}

function resetStore(entries: FileTreeNode[]) {
  useFileBrowserStore.getState().clearSearch();
  useFileBrowserStore.setState({
    entries,
    loading: false,
    loadingPaths: new Set(),
    error: null,
    errorPath: null,
    searchQuery: '',
    searchResults: [],
  });
}

const names = () => useFileBrowserStore.getState().searchResults.map((n) => n.name);

describe('fileBrowserStore search', () => {
  beforeEach(() => {
    listDirectory.mockReset();
  });

  it('finds matches inside folders that were never expanded', async () => {
    listDirectory.mockImplementation(
      fakeDisk({
        '/td': [
          ['browser', true],
          ['refs', true],
          ['T1w.nii', false],
        ],
        '/td/browser': [
          ['oblique.nii.gz', false],
          ['oblique4d.nii', false],
          ['deep', true],
        ],
        '/td/browser/deep': [['oblique_deep.nii', false]],
        '/td/refs': [['mni.nii.gz', false]],
      }),
    );
    resetStore([root('/td')]);

    useFileBrowserStore.getState().setSearchQuery('oblique');

    await vi.waitFor(() => {
      expect(useFileBrowserStore.getState().searchIndexing).toBe(false);
    });
    expect(names().sort()).toEqual(['oblique.nii.gz', 'oblique4d.nii', 'oblique_deep.nii']);
    // Indexing fills children but never expands folders (that is the tree's job).
    const browser = useFileBrowserStore
      .getState()
      .entries[0].children!.find((c) => c.name === 'browser')!;
    expect(browser.expanded).toBe(false);
    expect(browser.children?.map((c) => c.name)).toContain('oblique.nii.gz');
    expect(useFileBrowserStore.getState().searchTruncated).toBe(false);
  });

  it('later keystrokes reuse folders already listed', async () => {
    listDirectory.mockImplementation(
      fakeDisk({
        '/td2': [['browser', true]],
        '/td2/browser': [['oblique.nii', false]],
      }),
    );
    resetStore([root('/td2')]);
    const store = useFileBrowserStore.getState();
    store.setSearchQuery('obl');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    const calls = listDirectory.mock.calls.length;

    store.setSearchQuery('obliq');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory.mock.calls.length).toBe(calls);
    expect(names()).toEqual(['oblique.nii']);
  });

  it('clearing the search stops the crawl between listings', async () => {
    const pending: Array<() => void> = [];
    const disk = fakeDisk({
      '/td32': [
        ['a', true],
        ['b', true],
      ],
      '/td32/a': [['x.nii', false]],
      '/td32/b': [['y.nii', false]],
    });
    listDirectory.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          pending.push(() => resolve(disk(path)));
        }),
    );
    resetStore([root('/td32')]);
    useFileBrowserStore.getState().setSearchQuery('x');
    await vi.waitFor(() => expect(pending).toHaveLength(1)); // '/td32'

    useFileBrowserStore.getState().clearSearch();
    pending.shift()!();
    await new Promise((r) => setTimeout(r, 0));

    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(useFileBrowserStore.getState().searchIndexing).toBe(false);
    expect(useFileBrowserStore.getState().searchResults).toEqual([]);
  });

  it('stops at the per-root listing budget and reports the search as partial', async () => {
    // A root with many sibling folders, each holding one more folder.
    const layout: Record<string, Array<[string, boolean]>> = {
      '/big': Array.from({ length: 80 }, (_, i) => [`d${i}`, true] as [string, boolean]),
    };
    for (let i = 0; i < 80; i++) layout[`/big/d${i}`] = [['nested', true]];
    listDirectory.mockImplementation(fakeDisk(layout));
    resetStore([root('/big', 'remote')]);

    useFileBrowserStore.getState().setSearchQuery('zzz');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false), {
      timeout: 5000,
    });
    // Remote budget: 60 listings, one at a time.
    expect(listDirectory).toHaveBeenCalledTimes(60);
    expect(useFileBrowserStore.getState().searchTruncated).toBe(true);
  });

  it('remote roots are listed one folder at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const disk = fakeDisk({
      '/r': [
        ['a', true],
        ['b', true],
        ['c', true],
      ],
      '/r/a': [],
      '/r/b': [],
      '/r/c': [],
    });
    listDirectory.mockImplementation(async (path: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return disk(path);
    });
    resetStore([root('/r', 'remote')]);
    useFileBrowserStore.getState().setSearchQuery('q');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(1);
  });
});

describe('fileBrowserStore search crawl safeguards', () => {
  beforeEach(() => {
    listDirectory.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never runs two remote listings at once, even across remote roots', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const disk = fakeDisk({
      '/ra': [['x', true]],
      '/ra/x': [],
      '/rb': [['y', true]],
      '/rb/y': [],
    });
    listDirectory.mockImplementation(async (path: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return disk(path);
    });
    resetStore([root('/ra', 'remote'), root('/rb', 'remote')]);
    useFileBrowserStore.getState().setSearchQuery('q');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(1);
  });

  it('shares the hover-prefetch single-flight slot on remote mounts', async () => {
    const disk = fakeDisk({ '/rp': [['a', true]], '/rp/a': [], '/rp/hover': [] });
    let releaseHover: () => void = () => {};
    listDirectory.mockImplementation((path: string) =>
      path === '/rp/hover'
        ? new Promise((resolve) => {
            releaseHover = () => resolve(disk(path));
          })
        : disk(path),
    );
    resetStore([root('/rp', 'remote')]);
    useFileBrowserStore.getState().prefetchDirectory('/rp/hover'); // holds the slot
    useFileBrowserStore.getState().setSearchQuery('q');
    await new Promise((r) => setTimeout(r, 30));
    // Only the hover listing has run; the crawl is waiting for the slot.
    expect(listDirectory.mock.calls.map(([p]) => p)).toEqual(['/rp/hover']);
    expect(useFileBrowserStore.getState().searchIndexing).toBe(true);

    releaseHover();
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory.mock.calls.map(([p]) => p)).toEqual(['/rp/hover', '/rp', '/rp/a']);
  });

  it('waits while a user-initiated load is running', async () => {
    listDirectory.mockImplementation(fakeDisk({ '/wl': [] }));
    resetStore([root('/wl')]);
    useFileBrowserStore.setState({ loading: true });
    useFileBrowserStore.getState().setSearchQuery('q');
    await new Promise((r) => setTimeout(r, 30));
    expect(listDirectory).not.toHaveBeenCalled();

    useFileBrowserStore.setState({ loading: false });
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledWith('/wl', 1);
  });

  it('a folder that failed is skipped for one search and retried by the next', async () => {
    let fail = true;
    const disk = fakeDisk({ '/rf': [['ok.nii', false]] });
    listDirectory.mockImplementation((path: string) =>
      fail ? Promise.reject(new Error('EACCES')) : disk(path),
    );
    resetStore([root('/rf')]);
    useFileBrowserStore.getState().setSearchQuery('ok');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(names()).toEqual([]);

    fail = false;
    useFileBrowserStore.getState().clearSearch();
    useFileBrowserStore.getState().setSearchQuery('ok');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledTimes(2);
    expect(names()).toEqual(['ok.nii']);
  });

  it('a hung listing times out and the search finishes', async () => {
    vi.useFakeTimers();
    const disk = fakeDisk({ '/th': [['hung', true], ['fine', true]], '/th/fine': [['match.nii', false]] });
    listDirectory.mockImplementation((path: string) =>
      path === '/th/hung' ? new Promise(() => {}) : disk(path),
    );
    resetStore([root('/th')]);
    useFileBrowserStore.getState().setSearchQuery('match');
    await vi.advanceTimersByTimeAsync(0);
    expect(useFileBrowserStore.getState().searchIndexing).toBe(true);

    await vi.advanceTimersByTimeAsync(LOCAL_SEARCH_LIMITS.listingTimeoutMs + 10);
    expect(useFileBrowserStore.getState().searchIndexing).toBe(false);
    expect(names()).toEqual(['match.nii']);
  });

  it('keeps searchIndexing on when retyping while the previous crawl is still listing', async () => {
    let release: () => void = () => {};
    const disk = fakeDisk({ '/rt': [] });
    listDirectory.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          release = () => resolve(disk(path));
        }),
    );
    resetStore([root('/rt')]);
    const store = useFileBrowserStore.getState();
    store.setSearchQuery('a');
    await vi.waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(1));
    store.clearSearch();
    store.setSearchQuery('b');
    expect(useFileBrowserStore.getState().searchIndexing).toBe(true);

    release();
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
  });

  it('marks the search partial when the depth limit is reached', async () => {
    // A chain deeper than the local depth limit.
    const layout: Record<string, Array<[string, boolean]>> = {};
    let path = '/deep';
    for (let i = 0; i <= LOCAL_SEARCH_LIMITS.maxDepth + 1; i++) {
      layout[path] = [[`l${i}`, true]];
      path = `${path}/l${i}`;
    }
    layout[path] = [];
    listDirectory.mockImplementation(fakeDisk(layout));
    resetStore([root('/deep')]);
    useFileBrowserStore.getState().setSearchQuery('zzz');
    await vi.waitFor(() => expect(useFileBrowserStore.getState().searchIndexing).toBe(false));
    expect(listDirectory).toHaveBeenCalledTimes(LOCAL_SEARCH_LIMITS.maxDepth + 1);
    expect(useFileBrowserStore.getState().searchTruncated).toBe(true);
  });
});

describe('fileBrowserSearch helpers', () => {
  const tree: FileTreeNode = {
    ...root('/m'),
    children: [
      { ...root('/m/sub'), depth: 1, children: [] },
      { ...root('/m/.git'), depth: 1, children: [] },
      { id: '/m/sub.nii', name: 'sub.nii', path: '/m/sub.nii', type: 'file', depth: 1 },
    ],
  };

  it('reports each matching path once', () => {
    const duplicate = { ...tree, children: [...tree.children!] };
    expect(collectSearchMatches([tree, duplicate], 'sub').map((n) => n.path)).toEqual([
      '/m/sub',
      '/m/sub.nii',
    ]);
  });

  it('lists unlisted folders breadth first and skips dot folders', () => {
    expect(nextDirectoriesToIndex(tree, new Set(['/m']), LOCAL_SEARCH_LIMITS.maxDepth, 10)).toEqual({
      paths: ['/m/sub'],
      depthLimited: false,
    });
    expect(nextDirectoriesToIndex(tree, new Set(['/m', '/m/sub']), 8, 10).paths).toEqual([]);
  });

  it('reports a depth-limited search when unlisted folders sit below maxDepth', () => {
    // '/m' is listed; its unlisted child '/m/sub' is at depth 1 > maxDepth 0.
    expect(nextDirectoriesToIndex(tree, new Set(['/m']), 0, 10)).toEqual({
      paths: [],
      depthLimited: true,
    });
    // Dot folders never count as skipped work.
    expect(nextDirectoriesToIndex(tree, new Set(['/m', '/m/sub']), 0, 10).depthLimited).toBe(false);
  });

  it('owning root is the longest matching prefix', () => {
    const roots = [{ path: '/data/test-data' }, { path: '/data/test-data/refs' }];
    expect(findOwningRoot(roots, '/data/test-data/refs/a.nii')?.path).toBe('/data/test-data/refs');
    expect(findOwningRoot(roots, '/data/test-data/refs')?.path).toBe('/data/test-data/refs');
    expect(findOwningRoot(roots, '/data/test-data/other.nii')?.path).toBe('/data/test-data');
    expect(findOwningRoot(roots, '/data/test-data-2/x.nii')).toBeNull();
    expect(findOwningRoot(roots, null)).toBeNull();
  });
});
