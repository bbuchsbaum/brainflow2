import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCoordinationService } from '../StudioCoordinationService';
import {
  activeStudioBackground,
  selectStudioBackgroundNote,
  selectStudioBackgroundPath,
  type StudioGridHeader,
} from '../studioBackground';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { SpatialFieldSetSummary, StudioMemberSummary } from '@/types/studio';

const mocks = vi.hoisted(() => ({
  ensureMemberDisplayed: vi.fn(),
  syncBackground: vi.fn(),
  retryBackground: vi.fn(),
  readMemberGridHeader: vi.fn(),
}));

vi.mock('../StudioCompareService', () => ({
  getStudioCompareService: () => ({ materializeComparePanes: vi.fn() }),
}));
vi.mock('../StudioDisplayService', () => ({
  getStudioDisplayService: () => ({
    ensureMemberDisplayed: mocks.ensureMemberDisplayed,
    syncBackground: mocks.syncBackground,
    retryBackground: mocks.retryBackground,
  }),
}));
vi.mock('../studioMemberGrid', () => ({ readMemberGridHeader: mocks.readMemberGridHeader }));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit: vi.fn() }) }));

const NLIN6 = 'template:MNI152NLin6Asym_T1w_1mm';
const NLIN2009 = 'template:MNI152NLin2009cAsym_brain_1mm';

const grid = (dims: number[], mm: number, first: number[]): StudioGridHeader => ({
  dims,
  voxelToWorld: [mm, 0, 0, first[0], 0, mm, 0, first[1], 0, 0, mm, first[2], 0, 0, 0, 1],
  sformCode: 1,
  qformCode: 1,
});
/** The owner's maps: the MNI152 2 mm lattice, scanner codes, half-voxel origin. */
const MNI_2MM = grid([91, 109, 91], 2, [-90.5, -126.5, -72.5]);
const MNI_2009C = grid([97, 115, 97], 2, [-96.5, -132.5, -78.5]);
const NATIVE = grid([64, 64, 36], 3, [-96, -96, -54]);

const path = (id: string) => `/maps/${id}/enc_rep/maps/same_item.nii.gz`;
const members: StudioMemberSummary[] = ['sub-1006', 'sub-1007', 'sub-1008'].map((id) => ({
  id,
  sourcePath: path(id),
}));

function folderSet(id: string, more: Partial<SpatialFieldSetSummary> = {}) {
  return {
    id,
    name: id,
    sourceKind: 'imported',
    memberCount: members.length,
    primaryFeatureId: 'map',
    supportKind: 'volume',
    supportLabel: 'headers not sampled',
    alignmentClass: 'unknown',
    designColumns: [],
    designTablePreview: null,
    memberSummaries: members,
    memberIds: members.map((member) => member.id),
    savedCohortIds: [],
    ...more,
  } as unknown as SpatialFieldSetSummary;
}

function open(set: SpatialFieldSetSummary, activeMemberId = members[0].id) {
  useSetStudioStore.getState().bootstrapStudio({
    set,
    features: [{ id: 'map', label: 'Map', kind: 'volume' }],
    cohorts: [],
    expressions: [],
    selection: { activeLens: 'deck', activeMemberId, compareCohortId: null },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
}

const store = () => useSetStudioStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastBackground = () => mocks.syncBackground.mock.calls.at(-1)?.[0];

describe('StudioCoordinationService grid-matched background', () => {
  let service: StudioCoordinationService;
  /** The header each member's file has. */
  let headers: Record<string, StudioGridHeader | null>;

  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    headers = {
      [path('sub-1006')]: MNI_2MM,
      [path('sub-1007')]: NATIVE,
      [path('sub-1008')]: MNI_2MM,
    };
    mocks.ensureMemberDisplayed.mockReset();
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    mocks.retryBackground.mockReset();
    mocks.syncBackground.mockReset();
    mocks.syncBackground.mockImplementation(async (sourcePath: string | null) => ({
      status: sourcePath ? 'ready' : 'none',
      sourcePath,
    }));
    mocks.readMemberGridHeader.mockReset();
    mocks.readMemberGridHeader.mockImplementation(async (sourcePath: string) => headers[sourcePath]);
    service = new StudioCoordinationService();
  });
  afterEach(() => service.stop());

  it('turns the matching template on once the first member has loaded', async () => {
    const load = deferred<void>();
    mocks.ensureMemberDisplayed.mockReturnValue(load.promise);
    open(folderSet('folder'));
    service.start();
    // Nothing is known before the member is there: no background yet.
    expect(lastBackground()).toBeNull();
    expect(mocks.readMemberGridHeader).not.toHaveBeenCalled();

    load.resolve();
    await settle();
    expect(store().studioGridEvidence).toMatchObject({
      setId: 'folder',
      memberId: 'sub-1006',
      space: 'MNI152NLin6Asym',
    });
    expect(lastBackground()).toBe(NLIN6);
    expect(activeStudioBackground(store()).origin).toBe('grid');
    expect(selectStudioBackgroundNote(store())).toBe(
      "MNI152 grid matched from this image (91 × 109 × 91, 2 mm); the other images were not checked.",
    );
    // The user never chose: the choice is still open.
    expect(store().studioBackground).toBeNull();
    // One header read for the member, however often the store changed.
    expect(mocks.readMemberGridHeader).toHaveBeenCalledTimes(1);
    expect(mocks.readMemberGridHeader).toHaveBeenCalledWith(path('sub-1006'));
  });

  it('follows the active member: a member on another grid does not keep the template', async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    expect(lastBackground()).toBe(NLIN6);

    store().setActiveMember('sub-1007');
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1007', space: null });
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(selectStudioBackgroundNote(store())).toBeNull();
    expect(lastBackground()).toBeNull();

    // On to a member of the lattice again: the template is back.
    store().setActiveMember('sub-1008');
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1008' });
    expect(lastBackground()).toBe(NLIN6);
  });

  it('follows the member to another template lattice', async () => {
    headers[path('sub-1007')] = MNI_2009C;
    open(folderSet('folder'));
    service.start();
    await settle();
    store().setActiveMember('sub-1007');
    await settle();
    expect(lastBackground()).toBe(NLIN2009);
    expect(selectStudioBackgroundNote(store())).toMatch(/\(97 × 115 × 97, 2 mm\)/);
  });

  it('keeps the shown member\'s template while the next member loads, without reloading it', async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    const calls = mocks.syncBackground.mock.calls.length;

    const load = deferred<void>();
    mocks.ensureMemberDisplayed.mockReturnValue(load.promise);
    store().setActiveMember('sub-1008');
    await settle();
    // sub-1006's image is still the one on screen, and so is its template.
    expect(selectStudioBackgroundPath(store())).toBe(NLIN6);
    load.resolve();
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1008' });
    expect(mocks.syncBackground.mock.calls.length).toBe(calls);
  });

  it("drops a header that arrives for a member paged away from", async () => {
    const slow = deferred<StudioGridHeader | null>();
    mocks.readMemberGridHeader.mockImplementation((sourcePath: string) =>
      sourcePath === path('sub-1006') ? slow.promise : Promise.resolve(headers[sourcePath]),
    );
    open(folderSet('folder'));
    service.start();
    await settle();
    expect(store().studioGridEvidence).toBeNull();

    store().setActiveMember('sub-1007');
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1007', space: null });

    slow.resolve(MNI_2MM);
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1007', space: null });
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(mocks.syncBackground).not.toHaveBeenCalledWith(NLIN6);
  });

  it("drops a header that arrives after another set was opened", async () => {
    const slow = deferred<StudioGridHeader | null>();
    mocks.readMemberGridHeader.mockReturnValueOnce(slow.promise);
    open(folderSet('folder'));
    service.start();
    await settle();

    headers[path('sub-1006')] = NATIVE;
    open(folderSet('other'));
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ setId: 'other', space: null });

    slow.resolve(MNI_2MM);
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ setId: 'other', space: null });
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(mocks.syncBackground).not.toHaveBeenCalledWith(NLIN6);
  });

  it("does not carry one set's evidence into the next", async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    expect(lastBackground()).toBe(NLIN6);

    const load = deferred<void>();
    mocks.ensureMemberDisplayed.mockReturnValue(load.promise);
    open(folderSet('other'));
    await settle();
    expect(store().studioGridEvidence).toBeNull();
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(lastBackground()).toBeNull();
  });

  it('leaves no evidence for a member that did not load', async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    headers[path('sub-1008')] = null;
    store().setActiveMember('sub-1008');
    await settle();
    expect(store().studioGridEvidence).toBeNull();
    expect(lastBackground()).toBeNull();

    // The Deck's Retry loads it: its header is read then.
    headers[path('sub-1008')] = MNI_2MM;
    service.retryActiveMember();
    await settle();
    expect(lastBackground()).toBe(NLIN6);
  });

  it('survives a header read that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.readMemberGridHeader.mockRejectedValue(new Error('volume gone'));
    open(folderSet('folder'));
    service.start();
    await settle();
    expect(store().studioGridEvidence).toBeNull();
    expect(lastBackground()).toBeNull();
    expect(mocks.readMemberGridHeader).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('an explicit None after the automatic fill sticks for the set', async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    expect(lastBackground()).toBe(NLIN6);

    service.chooseBackground(null);
    expect(lastBackground()).toBeNull();
    store().setActiveMember('sub-1008');
    await settle();
    expect(store().studioGridEvidence).toMatchObject({ memberId: 'sub-1008', space: 'MNI152NLin6Asym' });
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(lastBackground()).toBeNull();
    expect(activeStudioBackground(store()).origin).toBe('chosen');
  });

  it('gives Population the template only when the set was audited as that one grid', async () => {
    open(folderSet('folder'));
    service.start();
    await settle();
    store().setActiveLens('population');
    expect(selectStudioBackgroundPath(store())).toBeNull();

    // The grid check finds every header on the grid of the member read.
    store().applySetAudit('folder', {
      ...folderSet('folder'),
      supportLabel: '91×109×91 voxels · 2.00×2.00×2.00 mm (sampled)',
      alignmentClass: 'same-grid',
    });
    expect(selectStudioBackgroundPath(store())).toBe(NLIN6);
    expect(selectStudioBackgroundNote(store())).toBe(
      'MNI152 grid matched from the images (91 × 109 × 91, 2 mm); not declared by the files.',
    );
  });

  describe('a member with no file of its own to read', () => {
    // sub-1007 has no single source path (its header cannot be read).
    const sparse = members.map((member) =>
      member.id === 'sub-1007' ? { ...member, sourcePath: null } : member,
    ) as StudioMemberSummary[];

    it('does not keep the template of the member shown before it', async () => {
      open(folderSet('folder', { memberSummaries: sparse }));
      service.start();
      await settle();
      expect(lastBackground()).toBe(NLIN6);

      store().setActiveMember('sub-1007');
      await settle();
      // sub-1006's header says nothing about this member: no evidence, no template.
      expect(store().studioGridEvidence).toBeNull();
      expect(selectStudioBackgroundPath(store())).toBeNull();
      expect(selectStudioBackgroundNote(store())).toBeNull();
      expect(lastBackground()).toBeNull();
      expect(mocks.readMemberGridHeader).toHaveBeenCalledTimes(1);

      // Back on a member that has one: read again, and the template returns.
      store().setActiveMember('sub-1006');
      await settle();
      expect(mocks.readMemberGridHeader).toHaveBeenCalledTimes(2);
      expect(lastBackground()).toBe(NLIN6);
    });

    it('keeps the template in a set audited to be on one grid, with no flicker while paging', async () => {
      open(
        folderSet('folder', {
          memberSummaries: sparse,
          supportLabel: '91×109×91 voxels · 2.00×2.00×2.00 mm (sampled)',
          alignmentClass: 'same-grid',
        }),
      );
      service.start();
      await settle();
      expect(lastBackground()).toBe(NLIN6);
      const calls = mocks.syncBackground.mock.calls.length;

      for (const id of ['sub-1007', 'sub-1008', 'sub-1007', 'sub-1006']) {
        store().setActiveMember(id);
        expect(selectStudioBackgroundPath(store())).toBe(NLIN6);
        await settle();
        expect(selectStudioBackgroundPath(store())).toBe(NLIN6);
      }
      // The template was never taken off or asked for again.
      expect(mocks.syncBackground.mock.calls.slice(calls).every(([path]) => path === NLIN6)).toBe(true);
      expect(selectStudioBackgroundNote(store())).toMatch(/^MNI152 grid matched from the images /);
    });
  });

  it('does not read headers for a surface set', async () => {
    open(folderSet('surfaces', { supportKind: 'surface' }));
    service.start();
    await settle();
    expect(mocks.readMemberGridHeader).not.toHaveBeenCalled();
  });
});
