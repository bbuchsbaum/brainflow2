import { sampleLayerValueAtWorld } from '@brainflow/api';

export interface SampleOptions {
  layerId: string;
  world: [number, number, number];
}

export interface SampleResult {
  value: number | null;
  error?: Error;
}

const loggedErrorKeys: Set<string> = new Set();

function makeErrorKey(layerId: string, world: [number, number, number]): string {
  const rounded = world.map(v => v.toFixed(2)).join(',');
  return `${layerId}|${rounded}`;
}

export async function sampleLayerAtWorld(opts: SampleOptions): Promise<SampleResult> {
  const { layerId, world } = opts;
  try {
    const value = await sampleLayerValueAtWorld(layerId, world);
    if (Number.isFinite(value)) {
      return { value };
    }
    return { value: null };
  } catch (err: unknown) {
    const key = makeErrorKey(layerId, world);
    if (!loggedErrorKeys.has(key)) {
      loggedErrorKeys.add(key);
      console.error('[SamplingService] sampleLayerAtWorld failed', {
        layerId,
        world,
        error: err
      });
    }
    const error = err instanceof Error ? err : new Error(String(err));
    return { value: null, error };
  }
}

// Test-only helper to reset internal error cache between test cases.
export function __resetSamplingServiceErrorCacheForTests(): void {
  loggedErrorKeys.clear();
}
