/**
 * Pure helpers for the Files panel search.
 *
 * The tree is searched in place (react-arborist `searchTerm`), so these
 * helpers never build a second copy of the tree: `collectSearchMatches` only
 * reports which nodes match (for counts and the empty state), and
 * `nextDirectoriesToIndex` picks the folders the bounded background crawl
 * should list next so matches inside collapsed folders can be found.
 */

import type { FileTreeNode } from '@/types/filesystem';

/** Hard limits for the background crawl behind a search. */
export interface SearchCrawlLimits {
  /** Deepest folder level listed below a mounted root (root = 0). */
  maxDepth: number;
  /** Most folder listings one search session may issue. */
  maxListings: number;
  /** A listing slower than this counts as failed for the search. */
  listingTimeoutMs: number;
}

export const LOCAL_SEARCH_LIMITS: SearchCrawlLimits = {
  maxDepth: 8,
  maxListings: 400,
  listingTimeoutMs: 15_000,
};

/** Remote listings are SFTP round trips: fewer of them, one at a time. */
export const REMOTE_SEARCH_LIMITS: SearchCrawlLimits = {
  maxDepth: 6,
  maxListings: 60,
  listingTimeoutMs: 30_000,
};

/** Folders the crawl never descends into (version control, caches). */
const SKIPPED_DIRECTORY_NAMES = new Set(['node_modules', '__pycache__', '$RECYCLE.BIN']);

export function nodeMatchesQuery(name: string, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return false;
  return name.toLowerCase().includes(term);
}

/**
 * Every node whose name matches, at most once per path (a folder mounted
 * both as a root and inside another root is reported once).
 */
export function collectSearchMatches(
  entries: readonly FileTreeNode[],
  query: string,
): FileTreeNode[] {
  const results: FileTreeNode[] = [];
  const seen = new Set<string>();
  const visit = (nodes: readonly FileTreeNode[]) => {
    for (const node of nodes) {
      if (!seen.has(node.path) && nodeMatchesQuery(node.name, query)) {
        seen.add(node.path);
        results.push(node);
      }
      if (node.children) visit(node.children);
    }
  };
  visit(entries);
  return results;
}

function isSkippedDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(name);
}

export interface DirectoriesToIndex {
  /** Unlisted folders to list next, breadth first. */
  paths: string[];
  /** True when unlisted folders exist below `maxDepth` (search is partial). */
  depthLimited: boolean;
}

/**
 * Folders under `root` that have not been listed yet, breadth first and
 * bounded by `maxDepth`. `known` answers whether a folder's children are
 * known (listed, or failed during this search).
 */
export function nextDirectoriesToIndex(
  root: FileTreeNode,
  known: { has(path: string): boolean },
  maxDepth: number,
  limit: number,
): DirectoriesToIndex {
  const paths: string[] = [];
  let depthLimited = false;
  const isKnown = (node: FileTreeNode) =>
    known.has(node.path) ||
    (node.children !== undefined && node.children.length > 0);
  let level: Array<{ node: FileTreeNode; depth: number }> = [
    { node: root, depth: 0 },
  ];
  while (level.length > 0 && paths.length < limit) {
    const next: Array<{ node: FileTreeNode; depth: number }> = [];
    for (const { node, depth } of level) {
      if (node.type !== "directory") continue;
      if (depth > 0 && isSkippedDirectory(node.name)) continue;
      if (!isKnown(node)) {
        paths.push(node.path);
        if (paths.length >= limit) break;
        continue;
      }
      const children = node.children ?? [];
      if (depth >= maxDepth) {
        if (
          children.some(
            (child) =>
              child.type === "directory" &&
              !isSkippedDirectory(child.name) &&
              !isKnown(child),
          )
        ) {
          depthLimited = true;
        }
        continue;
      }
      for (const child of children) {
        next.push({ node: child, depth: depth + 1 });
      }
    }
    level = next;
  }
  return { paths, depthLimited };
}

/**
 * The mounted root that owns `path`: the LONGEST matching root, so a folder
 * mounted inside another mounted folder resolves to itself, not its parent.
 */
export function findOwningRoot<T extends { path: string }>(
  roots: readonly T[],
  path: string | null | undefined,
): T | null {
  if (!path) return null;
  let best: T | null = null;
  for (const root of roots) {
    const base = root.path.replace(/\/+$/, '');
    if (path === root.path || path === base || path.startsWith(`${base}/`)) {
      if (!best || root.path.length > best.path.length) best = root;
    }
  }
  return best;
}
