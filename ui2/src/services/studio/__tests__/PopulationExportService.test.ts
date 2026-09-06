import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  buildPopulationSliceQuery,
  PopulationImages,
  type PopulationSliceDisplay,
} from '../PopulationSliceService';
import { freezePopulationExport, populationExportService } from '../PopulationExportService';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  invoke.mockReset();
});
function display(): PopulationSliceDisplay {
  const query = buildPopulationSliceQuery(
    useSetStudioStore.getState(),
    useViewStateStore.getState().activeWorkspaceKey,
    { crosshairMm: [0, 0, 0], orientation: 'axial', dimPx: [1, 1], zoom: 1, summary: 'mean' },
  ).query!;
  return {
    query,
    data: {
      plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [1, 1] },
      centerWorld: [0, 0, 0],
      summary: [2],
      focused: [2],
      validCounts: [2],
      eligibleCount: query.request.workingMemberIds.length,
      unitCount: 2,
      contextRange: [0, 2],
      sources: query.request.members.map((m) => ({
        memberId: m.memberId,
        revision: { sha256: 'a'.repeat(64), sourceBytes: 300 },
      })),
      sourceCacheHit: true,
      cachedBytes: 0,
      sampling: 'nearest',
    },
    images: new PopulationImages({ close() {} } as ImageBitmap, { close() {} } as ImageBitmap),
    effectLimit: 3,
    summaryLimit: 2,
  };
}
it('freezes selected operands, hashes and metadata independently of later state and display mutation', () => {
  const d = display();
  const frozen = freezePopulationExport(d);
  const id = frozen.population.workingMemberIds[0];
  d.query.request.workingMemberIds.length = 0;
  useSetStudioStore.getState().selectPopulationMembers([]);
  expect(frozen.population.workingMemberIds[0]).toBe(id);
  expect(frozen.population.members.every((m) => m.expectedSha256 === 'a'.repeat(64))).toBe(true);
  expect(frozen.context.displayScale.effectLimit).toBe(3);
});
it('refuses stale dataset, incomplete source revisions and absent mask provenance', () => {
  const d = display();
  d.data.sources[0].revision.sha256 = 'unknown';
  expect(() => freezePopulationExport(d)).toThrow(/digests/);
  const masked = display();
  masked.query.request.mask = { sourcePath: '/mask.nii' };
  expect(() => freezePopulationExport(masked)).toThrow(/mask digest/);
  const stale = display();
  stale.query.datasetKey = 'old';
  expect(() => freezePopulationExport(stale)).toThrow(/earlier dataset/);
});
it('uses the frozen operands after the directory chooser and cancels native work with listener cleanup', async () => {
  const frozen = freezePopulationExport(display());
  let finish!: (v: unknown) => void;
  invoke
    .mockResolvedValueOnce('/output')
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValue(undefined);
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = populationExportService.chooseAndExport(frozen, controller.signal);
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      'export_population_summary',
      expect.objectContaining({ request: { ...frozen, destinationDirectory: '/output' } }),
    ),
  );
  controller.abort();
  expect(invoke).toHaveBeenCalledWith('cancel_population_sample', expect.anything());
  finish({ directory: '/output/bundle' });
  await pending;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
it('does not export when the chooser is canceled or the view unmounts during it', async () => {
  invoke.mockResolvedValue(null);
  const frozen = freezePopulationExport(display());
  expect(
    await populationExportService.chooseAndExport(frozen, new AbortController().signal),
  ).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
  invoke.mockReset().mockResolvedValue('/output');
  const c = new AbortController();
  c.abort();
  expect(await populationExportService.chooseAndExport(frozen, c.signal)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('replays only the chosen saved record, independent of the active population', async () => {
  const before = useSetStudioStore.getState().population;
  invoke
    .mockResolvedValueOnce('/saved/provenance.json')
    .mockResolvedValueOnce('/target')
    .mockResolvedValueOnce({ directory: '/target/replay' });
  const result = await populationExportService.chooseAndReplay(new AbortController().signal);
  expect(result?.directory).toBe('/target/replay');
  expect(invoke).toHaveBeenLastCalledWith('replay_population_summary', {
    provenancePath: '/saved/provenance.json',
    destinationDirectory: '/target',
    ticket: expect.objectContaining({ id: expect.any(String) }),
  });
  expect(useSetStudioStore.getState().population).toBe(before);
});
it('stops at either canceled replay chooser and refuses work after abort', async () => {
  invoke.mockResolvedValueOnce(null);
  expect(await populationExportService.chooseAndReplay(new AbortController().signal)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
  invoke.mockReset().mockResolvedValueOnce('/saved/provenance.json').mockResolvedValueOnce(null);
  expect(await populationExportService.chooseAndReplay(new AbortController().signal)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(2);
  invoke.mockReset().mockResolvedValueOnce('/saved/provenance.json');
  const c = new AbortController();
  c.abort();
  expect(await populationExportService.chooseAndReplay(c.signal)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('propagates replay integrity failures and removes its cancellation listener', async () => {
  invoke
    .mockResolvedValueOnce('/saved/provenance.json')
    .mockResolvedValueOnce('/target')
    .mockRejectedValueOnce(new Error('Saved summary no longer matches.'));
  const c = new AbortController();
  const remove = vi.spyOn(c.signal, 'removeEventListener');
  await expect(populationExportService.chooseAndReplay(c.signal)).rejects.toThrow(
    /no longer matches/,
  );
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
