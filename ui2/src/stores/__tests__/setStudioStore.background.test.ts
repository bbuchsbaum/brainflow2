import { beforeEach, describe, expect, it } from 'vitest';
import { useSetStudioStore } from '../setStudioStore';
import {
  activeStudioBackground,
  selectStudioBackgroundPath,
  studioGridEvidence,
} from '@/services/studio/studioBackground';
import type { SpatialFieldSetSummary } from '@/types/studio';

const store = () => useSetStudioStore.getState();
const T1 = 'template:MNI152NLin2009cAsym_T1w_1mm';

function open(id: string, supportLabel: string, background?: string | null) {
  store().loadDemoSession();
  const demo = Object.values(store().sets)[0] as SpatialFieldSetSummary;
  store().bootstrapStudio({
    set: { ...demo, id, supportLabel },
    ...(background === undefined ? {} : { background }),
    features: Object.values(store().features),
    cohorts: [],
    expressions: [],
  });
}

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
});

describe('a set opened without a selection', () => {
  it('starts on its first member', () => {
    open('fresh', 'Folder of maps');
    const set = store().sets.fresh;
    expect(set.memberIds.length).toBeGreaterThan(2);
    expect(store().selection.activeMemberId).toBe(set.memberIds[0]);
  });
});

describe('Set studio background', () => {
  it("a new set starts unchosen: its declared space's template", () => {
    open('declared', 'MNI152NLin2009cAsym (2mm)');
    expect(store().studioBackground).toBeNull();
    expect(activeStudioBackground(store())).toEqual({
      sourcePath: 'template:MNI152NLin2009cAsym_brain_1mm',
      issue: null,
      origin: 'space',
    });
  });

  it('a set that declares no space starts with none, never a template', () => {
    open('folder', 'Folder of maps');
    expect(store().studioBackground).toBeNull();
    expect(selectStudioBackgroundPath(store())).toBeNull();
  });

  it('a background given at bootstrap is a choice for that set', () => {
    open('saved', 'Verified saved native grid', T1);
    expect(store().studioBackground).toEqual({ setId: 'saved', sourcePath: T1 });
    expect(selectStudioBackgroundPath(store())).toBe(T1);
    // Only template sources are accepted.
    open('saved-2', 'Verified saved native grid', '/data/anat.nii.gz');
    expect(selectStudioBackgroundPath(store())).toBeNull();
  });

  it('a choice wins, "None" included, and belongs to the set it was made for', () => {
    open('declared', 'MNI152NLin2009cAsym (2mm)');
    store().setStudioBackground(T1);
    expect(selectStudioBackgroundPath(store())).toBe(T1);
    store().setStudioBackground(null);
    expect(store().studioBackground).toEqual({ setId: 'declared', sourcePath: null });
    expect(selectStudioBackgroundPath(store())).toBeNull();
    expect(activeStudioBackground(store()).origin).toBe('chosen');

    // Another set: back to its own space, and the issue of the last is gone.
    store().setStudioBackground(T1);
    store().setStudioBackgroundIssue({ sourcePath: T1, message: 'x' });
    open('other', 'MNI152NLin6Asym (2mm)');
    expect(store().studioBackground).toBeNull();
    expect(store().studioBackgroundIssue).toBeNull();
    expect(selectStudioBackgroundPath(store())).toBe('template:MNI152NLin6Asym_T1w_1mm');
  });

  it('does not notify for an unchanged choice or issue', () => {
    open('declared', 'MNI152NLin2009cAsym (2mm)');
    store().setStudioBackground(T1);
    store().setStudioBackgroundIssue({ sourcePath: T1, message: 'x' });
    let changes = 0;
    const off = useSetStudioStore.subscribe(() => {
      changes += 1;
    });
    store().setStudioBackgroundIssue({ sourcePath: T1, message: 'x' });
    expect(changes).toBe(0);
    // Choosing the same template again keeps its reported issue.
    store().setStudioBackground(T1);
    expect(changes).toBe(0);
    expect(store().studioBackgroundIssue).not.toBeNull();
    store().setStudioBackground('template:MNI305_T1w_native');
    expect(changes).toBe(1);
    expect(store().studioBackgroundIssue).toBeNull();
    off();
  });

  it('ignores a choice when no set is open', () => {
    store().setStudioBackground(T1);
    expect(store().studioBackground).toBeNull();
  });
  describe('grid evidence', () => {
    const header = {
      dims: [91, 109, 91],
      voxelToWorld: [2, 0, 0, -90.5, 0, 2, 0, -126.5, 0, 0, 2, -72.5, 0, 0, 0, 1],
      sformCode: 1,
      qformCode: 1,
    };
    const NLIN6 = 'template:MNI152NLin6Asym_T1w_1mm';

    it('fills the default in for the set it was read from, and goes with that set', () => {
      open('folder', 'Folder of maps');
      store().setStudioGridEvidence(studioGridEvidence('folder', 'sub001', header));
      expect(store().studioBackground).toBeNull();
      expect(activeStudioBackground(store())).toEqual({
        sourcePath: NLIN6,
        issue: null,
        origin: 'grid',
      });
      // A choice still wins, "None" included.
      store().setStudioBackground(null);
      expect(selectStudioBackgroundPath(store())).toBeNull();

      open('next', 'Folder of maps');
      expect(store().studioGridEvidence).toBeNull();
      expect(selectStudioBackgroundPath(store())).toBeNull();
      // Evidence that names another set is not this set's.
      store().setStudioGridEvidence(studioGridEvidence('folder', 'sub001', header));
      expect(selectStudioBackgroundPath(store())).toBeNull();
    });

    it('does not notify for unchanged evidence', () => {
      open('folder', 'Folder of maps');
      store().setStudioGridEvidence(studioGridEvidence('folder', 'sub001', header));
      let changes = 0;
      const off = useSetStudioStore.subscribe(() => {
        changes += 1;
      });
      store().setStudioGridEvidence(studioGridEvidence('folder', 'sub001', header));
      expect(changes).toBe(0);
      store().setStudioGridEvidence(studioGridEvidence('folder', 'sub002', header));
      expect(changes).toBe(1);
      store().setStudioGridEvidence(null);
      store().setStudioGridEvidence(null);
      expect(changes).toBe(2);
      off();
    });
  });
});
