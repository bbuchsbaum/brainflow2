import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationProbeActions } from '../PopulationProbeActions';
import { buildPopulationProbeQuery, populationSupportKey } from '../PopulationProbeController';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  invoke.mockReset();
});
it('shares a dataset-bound mask across image and probe queries without changing population or probe state', () => {
  let state = useSetStudioStore.getState();
  const key = populationSupportKey(state, 'workspace');
  state.setPopulationProbe(
    { supportKey: key, worldMm: [1, 2, 3], radiusMm: 3, reduce: 'mean' },
    'pin',
  );
  state = useSetStudioStore.getState();
  const prior = {
    working: state.population.working,
    probe: state.population.pinnedProbe,
    selection: state.selection,
  };
  const original = buildPopulationProbeQuery(state, 'workspace').query!;
  expect(populationProbeActions.configureMask({ sourcePath: '/mask.nii' })).toEqual({ ok: true });
  state = useSetStudioStore.getState();
  const probe = buildPopulationProbeQuery(state, 'workspace').query!;
  const image = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [1, 2, 3],
    orientation: 'axial',
    dimPx: [3, 3],
    zoom: 1,
    summary: 'mean',
  }).query!;
  expect(probe.request.locus.kind === 'set' && probe.request.locus.mask).toEqual({
    sourcePath: '/mask.nii',
  });
  expect(image.request.mask).toEqual({ sourcePath: '/mask.nii' });
  expect(probe.datasetKey).not.toBe(original.datasetKey);
  expect(state.population.working).toBe(prior.working);
  expect(state.population.pinnedProbe).toBe(prior.probe);
  expect(state.selection).toBe(prior.selection);
  expect(populationProbeActions.configureMask({ sourcePath: '  ' })).toMatchObject({ ok: false });
  const before = state.population;
  expect(populationProbeActions.configureMask({ sourcePath: '/mask.nii' })).toEqual({ ok: true });
  expect(useSetStudioStore.getState().population).toBe(before);
  expect(
    state.configurePopulationMask({ sourcePath: '/mask.nii', setId: 'another' }),
  ).toMatchObject({ ok: false });
  populationProbeActions.configureMask(null);
  expect(
    buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace').query!.datasetKey,
  ).toBe(original.datasetKey);
});
it('uses the installed native dialog and discards a choice made for another dataset', async () => {
  invoke.mockResolvedValueOnce('/mask.nii');
  expect(await populationProbeActions.chooseMask()).toEqual({ ok: true });
  expect(invoke).toHaveBeenCalledWith('plugin:dialog|open', {
    options: {
      multiple: false,
      directory: false,
      filters: [{ name: 'Binary NIfTI mask', extensions: ['nii', 'nii.gz'] }],
    },
  });
  invoke.mockResolvedValueOnce(null);
  await populationProbeActions.chooseMask();
  expect(useSetStudioStore.getState().population.mask?.sourcePath).toBe('/mask.nii');
  let finish!: (path: string) => void;
  invoke.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = populationProbeActions.chooseMask();
  const state = useSetStudioStore.getState();
  useSetStudioStore.setState({ selection: { ...state.selection, activeSetId: 'other' } });
  finish('/late.nii');
  expect(await pending).toMatchObject({ ok: false });
  expect(useSetStudioStore.getState().population.mask?.sourcePath).toBe('/mask.nii');
});

it('discards a pending mask choice after the same dataset is reimported', async () => {
  let finish!: (path: string) => void;
  invoke.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = populationProbeActions.chooseMask();
  const state = useSetStudioStore.getState();
  useSetStudioStore.setState({
    population: { ...state.population, sessionRevision: state.population.sessionRevision + 1 },
  });
  finish('/late.nii');
  expect(await pending).toMatchObject({ ok: false });
  expect(useSetStudioStore.getState().population.mask).toBeNull();
});
