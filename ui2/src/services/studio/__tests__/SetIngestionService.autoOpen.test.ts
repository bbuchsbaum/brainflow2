import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetIngestionService } from '../SetIngestionService';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { BackendTransport } from '@/services/transport';
import type { StudioImportCandidate } from '@/types/studio';
import {
  FOLDER_IMAGES,
  FOLDER_MEMBERS,
  FOLDER_ROOT,
  folderCandidate,
  folderGroups,
  folderProposal,
  folderSummary,
  flatFallback,
} from './studioFixtures';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** A backend whose header check (the ticketed preview with sampling on) is held open. */
function gatedBackend(preview: () => StudioImportCandidate = () => folderCandidate()) {
  const checks: Array<{
    ticket: unknown;
    finish: (candidates: StudioImportCandidate[]) => void;
    fail: (error: unknown) => void;
  }> = [];
  const cancelled: unknown[] = [];
  const invoke = vi.fn<Invoke>(async (command, args) => {
    if (command === 'cancel_population_sample') {
      cancelled.push(args?.ticket);
      return null;
    }
    if (command === 'preview_folder_ontology') return folderSummary();
    const request = (args?.request ?? {}) as { discoverySampleHeaders?: boolean };
    if (command === 'preview_set_studio_imports' && request.discoverySampleHeaders)
      return new Promise((resolve, reject) => {
        checks.push({
          ticket: args?.ticket,
          finish: (candidates) => resolve(candidates),
          fail: reject,
        });
      });
    return [preview()];
  });
  return { invoke, checks, cancelled };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  useFileBrowserStore.setState({ entries: [] });
  useAppModeStore.setState({ mode: 'studio' });
});

/** Open the folder as the active set, as the Studio does, without the review. */
async function openFolder(service: SetIngestionService) {
  await service.openFolderReview(FOLDER_ROOT);
  const state = useSetStudioStore.getState();
  expect(state.selection.activeSetId).toBe('folder-set');
  return state.sets['folder-set'];
}

describe('automatic image grid check', () => {
  it('starts by itself for a set whose headers nobody has read, and makes the set ready', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);
    expect(useSetStudioStore.getState().gridCheck.status).toBe('idle');

    service.autoCheckActiveSetGrids();

    expect(useSetStudioStore.getState().gridCheck).toEqual({ status: 'checking', message: null });
    expect(backend.checks).toHaveLength(1);
    backend.checks[0].finish([folderCandidate({ checked: true })]);
    await flush();
    const after = useSetStudioStore.getState();
    expect(after.gridCheck).toEqual({ status: 'idle', message: null });
    expect(after.sets['folder-set'].importContract?.readiness).toBe('compare_ready');
    expect(after.sets['folder-set'].alignmentClass).toBe('same-grid');
  });

  it('runs once per opened set: not again after it finished, failed or was asked twice', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);

    service.autoCheckActiveSetGrids();
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(1);
    backend.checks[0].fail(new Error('Mount is disconnected'));
    await flush();
    expect(useSetStudioStore.getState().gridCheck.status).toBe('failed');

    // A failure is the user's to retry; the automatic check does not loop.
    useSetStudioStore.getState().setGridCheck({ status: 'idle', message: null });
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(1);

    // The same folder opened again is a new set, and is checked.
    await openFolder(service);
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(2);
  });

  it('does not start again after the user cancels it, and tells the backend to stop', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);
    service.autoCheckActiveSetGrids();

    service.cancelGridCheck();
    await flush();

    expect(backend.cancelled).toEqual([backend.checks[0].ticket]);
    expect(useSetStudioStore.getState().gridCheck).toEqual({ status: 'idle', message: null });
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(1);
    // The set is still unchecked; "Check image grids" remains the user's.
    backend.checks[0].finish([folderCandidate({ checked: true })]);
    await flush();
    expect(useSetStudioStore.getState().sets['folder-set'].alignmentClass).toBe('unknown');
    void service.checkActiveSetGrids();
    expect(backend.checks).toHaveLength(2);
  });

  it('is cancelled when the Studio is left, and starts again on return', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);
    service.autoCheckActiveSetGrids();

    useAppModeStore.setState({ mode: 'imaging' });
    await flush();
    expect(backend.cancelled).toEqual([backend.checks[0].ticket]);
    expect(useSetStudioStore.getState().gridCheck.status).toBe('idle');
    // Outside the Studio nothing is checked.
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(1);
    // The late answer of the interrupted check is dropped.
    backend.checks[0].finish([folderCandidate({ checked: true })]);
    await flush();
    expect(useSetStudioStore.getState().sets['folder-set'].alignmentClass).toBe('unknown');

    useAppModeStore.setState({ mode: 'studio' });
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(2);
  });

  it('is cancelled when another set is opened, and its late result is dropped', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);
    service.autoCheckActiveSetGrids();

    useSetStudioStore.getState().loadDemoSession();
    await flush();
    expect(backend.cancelled).toEqual([backend.checks[0].ticket]);
    backend.checks[0].finish([folderCandidate({ checked: true })]);
    await flush();
    const state = useSetStudioStore.getState();
    expect(state.sets['folder-set'].alignmentClass).toBe('unknown');
    expect(state.gridCheck).toEqual({ status: 'idle', message: null });
    // The demo set has no folder to check.
    service.autoCheckActiveSetGrids();
    expect(backend.checks).toHaveLength(1);
  });

  it('does not read headers again when the review already did', async () => {
    const backend = gatedBackend(() => folderCandidate({ checked: true }));
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await openFolder(service);

    service.autoCheckActiveSetGrids();

    expect(backend.checks).toHaveLength(0);
    expect(useSetStudioStore.getState().gridCheck.status).toBe('idle');
  });
});

describe('opening a folder in one step', () => {
  it('opens a complete folder directly and says what it opened', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);

    await service.openFolderReview(FOLDER_ROOT);

    const state = useSetStudioStore.getState();
    expect(state.importDialog.isOpen).toBe(false);
    expect(state.selection.activeSetId).toBe('folder-set');
    expect(state.selection.activeLens).toBe('deck');
    expect(state.studioOpenNotice).toEqual({
      setId: 'folder-set',
      root: FOLDER_ROOT,
      message: 'Opened 3 members × 3 images from enc_rep_rsa.',
    });
    // One scan and one preview: no second "checking files" pass.
    expect(
      backend.invoke.mock.calls.filter(([command]) => command === 'preview_set_studio_imports'),
    ).toHaveLength(1);
  });

  it('names the set after its folder and keeps where it lives', async () => {
    useFileBrowserStore.setState({
      entries: [
        {
          path: '/cache/mount-a',
          name: 'dsets',
          type: 'directory',
          mountSource: {
            kind: 'remote',
            remotePath: '/scratch/brad/dsets',
            host: 'trillium.alliancecan.ca',
            label: 'brad@trillium.alliancecan.ca',
          },
        },
      ] as never,
    });
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);

    const set = await openFolder(service);

    expect(set.name).toBe('enc_rep_rsa');
    expect(set.name).not.toMatch(/Discovery Import|trillium/);
    expect(set.sourceLocation).toEqual({
      label: 'brad@trillium.alliancecan.ca',
      path: '/scratch/brad/dsets/pcmri/derivatives/enc_rep_rsa',
    });
  });

  it('keeps the name a table or manifest import gave its set', () => {
    const manifest = folderCandidate();
    manifest.mode = 'manifest';
    manifest.discovery = null;
    manifest.set.name = 'Encoding study';
    const store = useSetStudioStore.getState();
    store.openImportDialog('manifest');
    store.setImportPreviewResult('manifest', [manifest], 'backend');
    useSetStudioStore.getState().confirmImportCandidate();
    const set = useSetStudioStore.getState().sets['folder-set'];
    expect(set.name).toBe('Encoding study');
    expect(set.sourceLocation).toBeUndefined();
  });

  it('shows the review when a member is missing an image, and opens nothing', async () => {
    const groups = folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES);
    groups[2] = { ...groups[2], bindings: groups[2].bindings.slice(1) };
    const incomplete = folderCandidate({ groups });
    const invoke = vi.fn<Invoke>(async (command) =>
      command === 'preview_folder_ontology'
        ? folderSummary([folderProposal({ groups }), flatFallback()])
        : [incomplete],
    );
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await service.openFolderReview(FOLDER_ROOT);

    const state = useSetStudioStore.getState();
    expect(state.importDialog.isOpen).toBe(true);
    expect(state.importDialog.folderReview).toBe(true);
    expect(state.selection.activeSetId).toBeNull();
    expect(state.studioOpenNotice).toBeNull();
    // The review nobody asked for says why it is shown, there and in the console.
    expect(state.studioFolderReviewReason).toEqual({
      root: FOLDER_ROOT,
      reason: 'A member is missing an image or has two.',
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('A member is missing an image or has two.'),
    );
    info.mockRestore();
    // The reviewed draft still opens on confirmation, as before.
    await service.confirmReview();
    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');
    expect(useSetStudioStore.getState().studioOpenNotice).toBeNull();
  });

  it('shows the review when asked to, and from the notice of a set opened directly', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);

    await service.openFolderReview(FOLDER_ROOT, { review: true });
    expect(useSetStudioStore.getState().importDialog.folderReview).toBe(true);
    // A review that was asked for needs no reason.
    expect(useSetStudioStore.getState().studioFolderReviewReason).toBeNull();
    expect(useSetStudioStore.getState().selection.activeSetId).toBeNull();
    service.cancelReview();

    await service.openFolderReview(FOLDER_ROOT);
    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');
    await service.reviewOpenedFolder();
    const state = useSetStudioStore.getState();
    expect(state.importDialog.isOpen).toBe(true);
    expect(state.importDialog.folderReview).toBe(true);
    expect(state.importDialog.discoveryRoot).toBe(FOLDER_ROOT);
    // The open set is untouched while its folder is reviewed.
    expect(state.selection.activeSetId).toBe('folder-set');
  });

  it('does not replace a study that holds saved work without the review', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();
    const demo = useSetStudioStore.getState().selection.activeSetId;
    useSetStudioStore.setState({ activeDesignFilters: [{ column: 'group', value: 'control' }] });

    await service.openFolderReview(FOLDER_ROOT);

    const state = useSetStudioStore.getState();
    expect(state.selection.activeSetId).toBe(demo);
    expect(state.importDialog.folderReview).toBe(true);
  });

  it.each([
    [
      'groups defined in Population',
      () =>
        useSetStudioStore.setState((state) => ({
          population: {
            ...state.population,
            partition: { kind: 'column', column: 'group' } as never,
          },
        })),
    ],
    [
      'a Population selection',
      () =>
        useSetStudioStore.setState((state) => ({
          population: {
            ...state.population,
            working: { kind: 'members', memberIds: ['sub003'] } as never,
          },
        })),
    ],
    [
      'a selection that was undone (its history remains)',
      () =>
        useSetStudioStore.setState((state) => ({
          population: {
            ...state.population,
            selectionFuture: [{ kind: 'members', memberIds: ['sub003'] } as never],
          },
        })),
    ],
    [
      'a Population mask',
      () =>
        useSetStudioStore.setState((state) => ({
          population: { ...state.population, mask: { setId: 'x', sourcePath: '/m.nii' } as never },
        })),
    ],
    [
      'a participant definition',
      () =>
        useSetStudioStore.setState((state) => ({
          population: { ...state.population, participants: { column: 'subject' } as never },
        })),
    ],
    [
      'an inference',
      () =>
        useSetStudioStore.setState((state) => ({
          population: { ...state.population, inference: { method: 'oneSample' } as never },
        })),
    ],
    [
      'a pinned probe',
      () =>
        useSetStudioStore.setState((state) => ({
          population: {
            ...state.population,
            pinnedProbe: { supportKey: 's', worldMm: [0, 0, 0], radiusMm: 0, reduce: 'mean' } as never,
          },
        })),
    ],
    [
      'a relationship',
      () =>
        useSetStudioStore.setState((state) => ({
          population: { ...state.population, relationship: { kind: 'seed' } as never },
        })),
    ],
    ['a background chosen for the set', () => useSetStudioStore.getState().setStudioBackground(null)],
    [
      'a computed map among the recent artifacts',
      () =>
        useSetStudioStore.setState({
          artifactHistory: [{ id: 'mean', bindingKind: 'derived_field' } as never],
        }),
    ],
  ])('does not replace a study that holds %s without the review', async (_what, author) => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();
    const demo = useSetStudioStore.getState().selection.activeSetId;
    author();

    await service.openFolderReview(FOLDER_ROOT);

    const state = useSetStudioStore.getState();
    expect(state.selection.activeSetId).toBe(demo);
    expect(state.importDialog.folderReview).toBe(true);
    expect(state.studioFolderOpening).toBeNull();
  });

  it('does not count what the Studio writes by itself as work', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();
    // A hover, the frame in focus, the member images shown and the
    // Inspect/Montage view are not work a new set would discard.
    useSetStudioStore.setState((state) => ({
      population: {
        ...state.population,
        sessionRevision: state.population.sessionRevision + 3,
        hoverProbe: { supportKey: 's', worldMm: [0, 0, 0], radiusMm: 0, reduce: 'mean' } as never,
        focusedFrame: { memberId: 'sub003', frame: 2 },
        presentation: { ...state.population.presentation, arrangement: 'montage' as never },
      },
      artifactHistory: [{ id: 'member', bindingKind: 'member_source' } as never],
      // A background chosen for another set is not this study's.
      studioBackground: { setId: 'another-set', sourcePath: null },
    }));

    await service.openFolderReview(FOLDER_ROOT);

    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');
  });

  it('keeps saying "Opening" when the same folder is opened again while the first scan runs', async () => {
    const scans: Array<(value: unknown) => void> = [];
    const invoke = vi.fn<Invoke>(async (command) => {
      if (command === 'preview_folder_ontology')
        return new Promise((resolve) => {
          scans.push(resolve);
        });
      return [folderCandidate()];
    });
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    const first = service.openFolderReview(FOLDER_ROOT);
    const second = service.openFolderReview(FOLDER_ROOT);
    expect(scans).toHaveLength(2);
    // The first scan was superseded: it ends, and the second is still running.
    scans[0](folderSummary());
    await first;
    expect(useSetStudioStore.getState().studioFolderOpening).toBe(FOLDER_ROOT);
    expect(useSetStudioStore.getState().selection.activeSetId).toBeNull();

    scans[1](folderSummary());
    await second;
    expect(useSetStudioStore.getState().studioFolderOpening).toBeNull();
    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');
  });

  it('replaces a study with no saved work directly', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();

    await service.openFolderReview(FOLDER_ROOT);

    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');
  });

  it('opens nothing when the scan was cancelled or superseded while it ran', async () => {
    let release!: (value: unknown) => void;
    const invoke = vi.fn<Invoke>(async (command) => {
      if (command === 'cancel_population_sample') return null;
      if (command === 'preview_folder_ontology')
        return new Promise((resolve) => {
          release = resolve;
        });
      return [folderCandidate()];
    });
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    const pending = service.openFolderReview(FOLDER_ROOT);
    service.cancelReview();
    release(folderSummary());
    await pending;

    const state = useSetStudioStore.getState();
    expect(state.selection.activeSetId).toBeNull();
    expect(state.importDialog.isOpen).toBe(false);
    expect(state.studioOpenNotice).toBeNull();
  });

  it('says the folder is opening while it is scanned, and stops saying so once decided', async () => {
    let release!: (value: unknown) => void;
    const invoke = vi.fn<Invoke>(async (command) => {
      if (command === 'preview_folder_ontology')
        return new Promise((resolve) => {
          release = resolve;
        });
      return [folderCandidate()];
    });
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    const pending = service.openFolderReview(FOLDER_ROOT);
    expect(useSetStudioStore.getState().studioFolderOpening).toBe(FOLDER_ROOT);
    expect(useSetStudioStore.getState().importDialog.folderReview).toBe(true);
    release(folderSummary());
    await pending;
    expect(useSetStudioStore.getState().studioFolderOpening).toBeNull();
    expect(useSetStudioStore.getState().selection.activeSetId).toBe('folder-set');

    // A review that was asked for is a review from the start.
    const review = service.openFolderReview(FOLDER_ROOT, { review: true });
    expect(useSetStudioStore.getState().studioFolderOpening).toBeNull();
    release(folderSummary());
    await review;
    expect(useSetStudioStore.getState().importDialog.folderReview).toBe(true);
  });

  it('hands an incomplete folder to its review already scanned', async () => {
    const groups = folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES);
    groups[0] = { ...groups[0], bindings: groups[0].bindings.slice(1) };
    const invoke = vi.fn<Invoke>(async (command) =>
      command === 'preview_folder_ontology'
        ? folderSummary([folderProposal({ groups }), flatFallback()])
        : [folderCandidate({ groups })],
    );
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await service.openFolderReview(FOLDER_ROOT);

    const state = useSetStudioStore.getState();
    expect(state.studioFolderOpening).toBeNull();
    expect(state.importDialog.selectedCandidateId).toBe('candidate-regex-folder');
    expect(invoke.mock.calls.filter(([command]) => command === 'preview_folder_ontology')).toHaveLength(1);
  });

  it('clears the notice when another set is opened or it is dismissed', async () => {
    const backend = gatedBackend();
    const service = new SetIngestionService({ invoke: backend.invoke } as unknown as BackendTransport);
    await service.openFolderReview(FOLDER_ROOT);
    expect(useSetStudioStore.getState().studioOpenNotice).not.toBeNull();
    useSetStudioStore.getState().loadDemoSession();
    expect(useSetStudioStore.getState().studioOpenNotice).toBeNull();
  });
});
