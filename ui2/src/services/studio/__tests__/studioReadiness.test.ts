import { describe, expect, it } from 'vitest';
import type { SpatialFieldSetSummary, StudioGridCheckState } from '@/types/studio';
import { setNeedsGridCheck, studioReadiness } from '../studioReadiness';
import { folderCandidate } from './studioFixtures';

const IDLE: StudioGridCheckState = { status: 'idle', message: null };
const CHECKING: StudioGridCheckState = { status: 'checking', message: null };

/** A folder-opened set as the store holds it. */
function folderSet(
  options: { checked?: boolean } = {},
  overrides: Partial<SpatialFieldSetSummary> = {},
): SpatialFieldSetSummary {
  const candidate = folderCandidate(options);
  return {
    ...candidate.set,
    importContract: candidate.contract,
    discoveryRequest: {
      root: candidate.discovery!.root,
      filePattern: candidate.discovery!.filePattern,
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      requiredRoles: [],
      maxDepth: 4,
      maxFiles: 500,
    },
    ...overrides,
  };
}

function withSupport(
  set: SpatialFieldSetSummary,
  support: Partial<SpatialFieldSetSummary['ingestAudit']['support']>,
): SpatialFieldSetSummary {
  return {
    ...set,
    alignmentClass: support.alignmentClass ?? set.alignmentClass,
    ingestAudit: { ...set.ingestAudit, support: { ...set.ingestAudit.support, ...support } },
  };
}

describe('studioReadiness', () => {
  it('is ready, and silent, for a set whose grids were confirmed', () => {
    const set = folderSet({ checked: true });
    for (const lens of ['population', 'compare'] as const)
      expect(studioReadiness(set, IDLE, lens)).toMatchObject({ phase: 'ready', action: null });
    expect(studioReadiness(null, IDLE, 'population').phase).toBe('ready');
  });

  it('shows one neutral in-progress state while the headers are read', () => {
    for (const lens of ['population', 'compare'] as const) {
      const state = studioReadiness(folderSet(), CHECKING, lens);
      expect(state).toMatchObject({
        phase: 'checking',
        title: 'Checking image grids…',
        short: 'Image grids are being checked…',
        action: 'cancel',
      });
      expect(state.detail).toContain('by itself when this finishes');
    }
  });

  it('offers the check when nobody has read the headers and none is running', () => {
    const state = studioReadiness(folderSet(), IDLE, 'population');
    expect(state).toMatchObject({ phase: 'needs-check', action: 'check' });
    expect(state.short).toBe('Image grids have not been checked yet.');
  });

  it('says why a check failed and offers a retry', () => {
    const state = studioReadiness(
      folderSet(),
      { status: 'failed', message: 'The image grids could not be checked: mount disconnected' },
      'compare',
    );
    expect(state).toMatchObject({ phase: 'check-failed', action: 'retry' });
    expect(state.detail).toContain('mount disconnected');
    // A review that asked for the headers and could not read them all.
    const audited = withSupport(folderSet(), { severity: 'warning' });
    expect(studioReadiness(audited, IDLE, 'population')).toMatchObject({
      phase: 'check-failed',
      action: 'retry',
    });
  });

  it('offers to continue, not retry, a check whose headers were kept', () => {
    const stopped: StudioGridCheckState = {
      status: 'failed',
      message: 'Reading the image headers took longer than two minutes and was stopped.',
      resumable: true,
    };
    for (const lens of ['population', 'compare'] as const) {
      const state = studioReadiness(folderSet(), stopped, lens);
      expect(state).toMatchObject({
        phase: 'check-failed',
        action: 'continue',
        title: 'The image grid check is not finished',
      });
      expect(state.detail).toContain('took longer than two minutes');
    }
    // Without that, a failed check is a retry.
    expect(
      studioReadiness(folderSet(), { ...stopped, resumable: false }, 'population').action,
    ).toBe('retry');
  });

  it('says different grids cannot be averaged, with nothing to press', () => {
    const mixed = withSupport(folderSet(), { alignmentClass: 'mixed', severity: 'warning' });
    const compare = studioReadiness(mixed, IDLE, 'compare');
    expect(compare).toMatchObject({ phase: 'unavailable', action: null });
    expect(compare.short).toBe('These images are on different grids, so they cannot be averaged.');
    // A running check for another reason never dresses this as progress.
    expect(studioReadiness(mixed, CHECKING, 'compare').phase).toBe('unavailable');
    expect(studioReadiness(mixed, IDLE, 'population').detail).toContain('different grids');
  });

  it('uses no internal vocabulary', () => {
    const sets = [
      folderSet(),
      withSupport(folderSet(), { alignmentClass: 'mixed', severity: 'warning' }),
      withSupport(folderSet(), { severity: 'warning' }),
      folderSet({}, { discoveryRequest: undefined }),
    ];
    for (const set of sets)
      for (const check of [IDLE, CHECKING])
        for (const lens of ['population', 'compare'] as const) {
          const state = studioReadiness(set, check, lens);
          expect(`${state.title} ${state.detail} ${state.short}`).not.toMatch(
            /ingest|audit|compare-safe|cohort|bound|reducer|materializ|expression/i,
          );
        }
  });
});

describe('setNeedsGridCheck', () => {
  it('is true only for a folder-opened volume set whose headers were never read', () => {
    expect(setNeedsGridCheck(folderSet())).toBe(true);
    // The review already read them: whatever it found, it is not read again.
    expect(setNeedsGridCheck(folderSet({ checked: true }))).toBe(false);
    expect(
      setNeedsGridCheck(withSupport(folderSet(), { alignmentClass: 'mixed', severity: 'warning' })),
    ).toBe(false);
    expect(setNeedsGridCheck(withSupport(folderSet(), { severity: 'warning' }))).toBe(false);
    // No kept discovery (a table or manifest set): nothing to check with.
    expect(setNeedsGridCheck(folderSet({}, { discoveryRequest: undefined }))).toBe(false);
    expect(setNeedsGridCheck(folderSet({}, { supportKind: 'surface' }))).toBe(false);
    expect(setNeedsGridCheck(null)).toBe(false);
  });
});
