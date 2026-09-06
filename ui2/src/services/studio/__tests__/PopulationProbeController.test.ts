import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PopulationProbeController,
  summarizePopulationProbe,
  buildPopulationProbeQuery,
  populationSupportKey,
  type PopulationProbeQuery,
} from '../PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { SampleFrame } from '@/plotting';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
const frame = (value: number): SampleFrame => ({
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows: [{ member: 'S01', value }],
});
const query = (index: number, datasetKey = 'dataset'): PopulationProbeQuery => ({
  key: `${datasetKey}:${index}`,
  datasetKey,
  probe: { supportKey: 'support', worldMm: [index, 0, 0], radiusMm: 0, reduce: 'mean' },
  request: {
    datasetId: datasetKey,
    locus: {
      kind: 'set',
      worldMm: [index, 0, 0],
      radiusMm: 0,
      members: [{ memberId: 'S01', sourcePath: '/source.nii' }],
    },
  },
});
function deferred() {
  let resolve!: (value: SampleFrame) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SampleFrame>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PopulationProbeController ownership', () => {
  it('retains a readable native source-consistency error', async () => {
    const sample = vi.fn().mockRejectedValue({
      Input: {
        code: 2025,
        details: 'Population sources changed while sampling; refresh the query.',
      },
    });
    const controller = new PopulationProbeController(sample);
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    expect(controller.getSnapshot().error).toBe(
      'Population sources changed while sampling; refresh the query.',
    );
    expect(controller.getSnapshot().displayed).toBeNull();
    controller.stop();
  });

  it('admits only one call and coalesces pending probes to the latest query', async () => {
    const first = deferred();
    const last = deferred();
    const sample = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const controller = new PopulationProbeController(sample);
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    controller.request(query(2));
    expect(sample.mock.calls[0][1].aborted).toBe(true);
    controller.request(query(3));
    await vi.advanceTimersByTimeAsync(100);
    expect(sample).toHaveBeenCalledTimes(1);
    first.resolve(frame(1));
    await vi.advanceTimersByTimeAsync(40);
    expect(controller.getSnapshot().displayed).toBeNull();
    expect(sample).toHaveBeenCalledTimes(2);
    expect(sample.mock.calls[1][0].locus.worldMm).toEqual([3, 0, 0]);
    last.resolve(frame(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().displayed?.frame.rows[0].value).toBe(3);
    expect(controller.getSnapshot().pending).toBe(false);
    controller.stop();
  });

  it('identifies the previous result while refreshing and clears it across dataset/workspace boundaries', async () => {
    const sample = vi.fn().mockResolvedValue(frame(1));
    const controller = new PopulationProbeController(sample);
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    controller.request(query(2));
    expect(controller.getSnapshot().displayed?.query.key).toBe('dataset:1');
    expect(controller.getSnapshot().requested?.key).toBe('dataset:2');
    expect(controller.getSnapshot().pending).toBe(true);
    controller.request(query(1, 'another-workspace'));
    expect(controller.getSnapshot().displayed).toBeNull();
    controller.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('invalidates a running completion on stop and supports StrictMode restart', async () => {
    const first = deferred();
    const sample = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(frame(2));
    const controller = new PopulationProbeController(sample);
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    controller.stop();
    expect(sample.mock.calls[0][1].aborted).toBe(true);
    controller.start();
    controller.request(query(2));
    first.reject(new Error('obsolete failure'));
    await vi.advanceTimersByTimeAsync(40);
    expect(controller.getSnapshot().displayed?.query.key).toBe('dataset:2');
    expect(controller.getSnapshot().error).toBeNull();
    controller.stop();
  });

  it('does not resample identical definitions unless refresh is explicit', async () => {
    const sample = vi.fn().mockResolvedValue(frame(1));
    const controller = new PopulationProbeController(sample);
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    const before = controller.getSnapshot();
    controller.request(query(1));
    await vi.advanceTimersByTimeAsync(40);
    expect(controller.getSnapshot()).toBe(before);
    expect(sample).toHaveBeenCalledTimes(1);
    controller.request(query(1), true);
    await vi.advanceTimersByTimeAsync(40);
    expect(sample).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('rejects responses with missing, duplicated or foreign observation identities', async () => {
    for (const rows of [
      [],
      [{ member: 'wrong', value: 2 }],
      [
        { member: 'S01', value: 1 },
        { member: 'S01', value: 2 },
      ],
    ]) {
      const controller = new PopulationProbeController(async () => ({ ...frame(1), rows }));
      controller.request(query(1));
      await vi.advanceTimersByTimeAsync(40);
      expect(controller.getSnapshot().error).toMatch(/do not match/);
      expect(controller.getSnapshot().displayed).toBeNull();
      controller.stop();
    }
  });
});

describe('population probe query definitions', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    useSetStudioStore.getState().loadDemoSession();
    const state = useSetStudioStore.getState();
    state.setPopulationProbe(
      {
        supportKey: populationSupportKey(state, 'workspace'),
        worldMm: [1, 2, 3],
        radiusMm: 0,
        reduce: 'mean',
      },
      'pin',
    );
  });
  it('excludes focus, working membership, reference and list search from the sample key', () => {
    const initial = buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace');
    expect(initial.issue).toBeNull();
    const state = useSetStudioStore.getState();
    state.setActiveMember('sub006');
    state.selectPopulationMembers(['sub001']);
    state.setPopulationReferenceMode('complement');
    state.setDesignSearch('not visible');
    expect(buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace').query?.key).toBe(
      initial.query?.key,
    );
  });
  it('rejects old-workspace probes and unsupported feature sources instead of substituting the primary image', () => {
    expect(buildPopulationProbeQuery(useSetStudioStore.getState(), 'other').issue).toMatch(
      /another dataset or workspace/,
    );
    useSetStudioStore.setState((state) => ({
      selection: { ...state.selection, activeFeatureId: 'unbound' },
    }));
    expect(buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace').issue).toMatch(
      /no source/,
    );
  });
  it('rejects duplicate source records instead of choosing the first one', () => {
    const state = useSetStudioStore.getState();
    const id = state.selection.activeSetId!;
    const set = state.sets[id];
    useSetStudioStore.setState({
      sets: {
        ...state.sets,
        [id]: { ...set, memberSummaries: [...set.memberSummaries, set.memberSummaries[0]] },
      },
    });
    expect(buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace').issue).toMatch(
      /exactly one source/,
    );
  });
});

describe('population probe summaries', () => {
  it('keeps empty selections and missing values distinct from measured zero', () => {
    const sampled: SampleFrame = {
      ...frame(0),
      rows: [
        { member: 'zero', value: 0 },
        { member: 'missing', value: null },
        { member: 'high', value: 6 },
      ],
    };
    expect(summarizePopulationProbe(sampled, new Set(['zero', 'missing', 'high']))).toEqual({
      mean: 3,
      count: 2,
      unavailable: 1,
    });
    expect(summarizePopulationProbe(sampled, new Set(['zero']))).toEqual({
      mean: 0,
      count: 1,
      unavailable: 1,
    });
    expect(summarizePopulationProbe(sampled, new Set())).toEqual({
      mean: null,
      count: 0,
      unavailable: 1,
    });
  });
});

it('fits presentation once without sampling, retains it during probe changes, and resets across sources', async () => {
  const sample = vi.fn().mockResolvedValue(frame(1));
  const controller = new PopulationProbeController(sample);
  controller.request(query(1));
  expect(controller.arrange('witnesses')).toBe(false);
  await vi.advanceTimersByTimeAsync(40);
  expect(controller.arrange('witnesses')).toBe(true);
  const arrangement = controller.getSnapshot().arrangement!;
  expect(arrangement.witnessIds).toEqual(['S01']);
  controller.expandWitnesses();
  expect(controller.getSnapshot().arrangement?.orderedIds).toBe(arrangement.orderedIds);
  expect(controller.getSnapshot().arrangement?.mode).toBe('all');
  controller.request(query(2));
  expect(controller.arrange('all')).toBe(false);
  await vi.advanceTimersByTimeAsync(40);
  expect(controller.getSnapshot().arrangement?.query.key).toBe(query(1).key);
  expect(sample).toHaveBeenCalledTimes(2);
  controller.clearArrangement();
  expect(controller.getSnapshot().arrangement).toBeNull();
  expect(sample).toHaveBeenCalledTimes(2);
  controller.arrange('all');
  controller.request(query(1, 'new dataset'));
  expect(controller.getSnapshot().arrangement).toBeNull();
  controller.stop();
});
