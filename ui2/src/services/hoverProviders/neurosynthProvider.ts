/**
 * Neurosynth Provider
 *
 * Provides functional term associations for the hovered MNI coordinate
 * by querying the Neurosynth API. Returns top 5 associated terms with
 * z-scores.
 *
 * Only active when the loaded data is in MNI space (detected via layer
 * metadata or template name).
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';
import { useLayerStore } from '@/stores/layerStore';

// ------- API types -------------------------------------------------------

interface NeurosynthTermResult {
  term: string;
  z_score: number;
}

// The Neurosynth API returns an object keyed by term name with nested analysis
// results.  The exact shape varies by endpoint version, so we handle several
// plausible forms.
type NeurosynthApiResponse =
  | NeurosynthTermResult[]
  | Record<string, { z_score?: number; uniformity_test?: { z?: number } }>;

// ------- Internal state --------------------------------------------------

interface CacheEntry {
  entries: HoverInfoEntry[];
  fetchedAt: number;
}

// Cache keyed by "x_y_z" where each coordinate is rounded to the nearest 2 mm
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Debounce / in-flight request tracking
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// Back-off state for rate-limiting (HTTP 429)
let backOffUntil = 0;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60_000;
let backOffMs = BACKOFF_BASE_MS;

// Pending resolve queue for debounced requests
type Resolver = (entries: HoverInfoEntry[]) => void;
let pendingResolvers: Resolver[] = [];
let pendingCoord: [number, number, number] | null = null;

// ------- Helpers ---------------------------------------------------------

/** Round a coordinate value to the nearest 2 mm grid point. */
function snapTo2mm(v: number): number {
  return Math.round(v / 2) * 2;
}

/** Build cache key from (snapped) coordinates. */
function cacheKey(x: number, y: number, z: number): string {
  return `${snapTo2mm(x)}_${snapTo2mm(y)}_${snapTo2mm(z)}`;
}

/**
 * Detect whether the current session is in MNI space by inspecting layer
 * metadata and template names in the layer store.
 *
 * Heuristics (any match → true):
 *  1. Any layer's filePath contains "MNI" (case-insensitive)
 *  2. Any layer's sourcePath contains "MNI"
 *  3. Any layer's orientation or units metadata doesn't contradict MNI
 *  4. Any layer name (Layer.name) contains "MNI"
 */
function isMniSpace(): boolean {
  const state = useLayerStore.getState();

  for (const layer of state.layers) {
    // Check layer name
    if (layer.name && /MNI/i.test(layer.name)) {
      return true;
    }
    // Check source path (template path often contains MNI identifier)
    if (layer.sourcePath && /MNI/i.test(layer.sourcePath)) {
      return true;
    }

    // Check volume metadata
    const meta = state.layerMetadata.get(layer.id);
    if (meta) {
      if (meta.filePath && /MNI/i.test(meta.filePath)) {
        return true;
      }
      if (meta.sourcePath && /MNI/i.test(meta.sourcePath)) {
        return true;
      }
      // BIDS space entity check via sourcePath pattern like "MNI152NLin*"
      if (meta.source === 'template') {
        // Templates are almost always in MNI space
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse the Neurosynth API response into a sorted list of term/z-score pairs.
 * Returns up to `limit` entries, sorted by z-score descending.
 */
function parseResponse(data: NeurosynthApiResponse, limit = 5): Array<{ term: string; z: number }> {
  const results: Array<{ term: string; z: number }> = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.term && typeof item.z_score === 'number') {
        results.push({ term: item.term, z: item.z_score });
      }
    }
  } else if (data && typeof data === 'object') {
    for (const [term, value] of Object.entries(data)) {
      let z: number | undefined;
      if (typeof value === 'number') {
        z = value;
      } else if (value && typeof value === 'object') {
        z = value.z_score ?? value.uniformity_test?.z;
      }
      if (typeof z === 'number') {
        results.push({ term, z });
      }
    }
  }

  results.sort((a, b) => b.z - a.z);
  return results.slice(0, limit);
}

/**
 * Perform the actual Neurosynth fetch for the given (snapped) coordinates.
 * Returns HoverInfoEntry[] — empty array on any failure.
 */
async function fetchNeurosynth(x: number, y: number, z: number): Promise<HoverInfoEntry[]> {
  const key = cacheKey(x, y, z);

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.entries;
  }

  // Check back-off
  if (Date.now() < backOffUntil) {
    return [];
  }

  const sx = snapTo2mm(x);
  const sy = snapTo2mm(y);
  const sz = snapTo2mm(z);

  const url = `https://neurosynth.org/api/locations/${sx}_${sy}_${sz}/analyses/`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Network error / offline — fail silently
    return [];
  }

  if (response.status === 429) {
    backOffUntil = Date.now() + backOffMs;
    backOffMs = Math.min(backOffMs * 2, BACKOFF_MAX_MS);
    return [];
  }

  // Reset back-off on success
  backOffMs = BACKOFF_BASE_MS;

  if (!response.ok) {
    return [];
  }

  let data: NeurosynthApiResponse;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  const terms = parseResponse(data, 5);

  if (terms.length === 0) {
    const entries: HoverInfoEntry[] = [];
    cache.set(key, { entries, fetchedAt: Date.now() });
    return entries;
  }

  const entries: HoverInfoEntry[] = terms.map((t, i) => ({
    label: t.term,
    value: `z = ${t.z.toFixed(2)}`,
    priority: 60 + i,
    group: 'neurosynth',
  }));

  // Prepend a header entry
  const allEntries: HoverInfoEntry[] = [
    {
      label: 'Neurosynth',
      value: `top terms at (${sx}, ${sy}, ${sz})`,
      priority: 59,
      group: 'neurosynth',
    },
    ...entries,
  ];

  cache.set(key, { entries: allEntries, fetchedAt: Date.now() });
  return allEntries;
}

/**
 * Debounced fetch: waits DEBOUNCE_MS after the last call before firing.
 * Multiple callers waiting for the same debounce window all receive the same result.
 */
function debouncedFetch(coord: [number, number, number]): Promise<HoverInfoEntry[]> {
  return new Promise<HoverInfoEntry[]>((resolve) => {
    pendingCoord = coord;
    pendingResolvers.push(resolve);

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const resolvers = pendingResolvers;
      const finalCoord = pendingCoord!;
      pendingResolvers = [];
      pendingCoord = null;

      const result = await fetchNeurosynth(...finalCoord);
      for (const r of resolvers) {
        r(result);
      }
    }, DEBOUNCE_MS);
  });
}

// ------- Provider --------------------------------------------------------

export const neurosynthProvider: HoverInfoProvider = {
  id: 'neurosynth',
  displayName: 'Neurosynth Terms',
  priority: 60, // Show after atlas (30), before anything lower priority

  async getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
    // Only query if we're in MNI space
    if (!isMniSpace()) {
      return null;
    }

    return debouncedFetch(ctx.worldCoord);
  },
};

/** Clear the result cache (useful for testing). */
export function clearNeurosynthCache(): void {
  cache.clear();
}
