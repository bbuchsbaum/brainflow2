import { describe, expect, it } from 'vitest';
import { buildStudioComparePaneSpecs, StudioCompareService } from '../StudioCompareService';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';

const demoSet: SpatialFieldSetSummary = {
  id: 'demo-set',
  name: 'Demo Set',
  sourceKind: 'demo',
  memberCount: 3,
  primaryFeatureId: 'statmap',
  supportKind: 'volume',
  supportLabel: 'MNI152 2mm template',
  alignmentClass: 'same-grid',
  designColumns: ['subject'],
  designTablePreview: null,
  memberSummaries: [
    { id: 'sub001', sourcePath: 'template:MNI152NLin2009cAsym_T1w_2mm' },
    { id: 'sub002', sourcePath: 'template:MNI152NLin2009cAsym_T2w_2mm' },
    { id: 'sub003', sourcePath: 'template:MNI152NLin2009cAsym_brain_2mm' },
  ],
  memberIds: ['sub001', 'sub002', 'sub003'],
  savedCohortIds: ['cohort-a'],
  ingestAudit: {
    sourceLabel: 'Demo',
    join: {
      matchedRows: 3,
      unmatchedRows: 0,
      duplicateKeys: 0,
      severity: 'ok',
      issueDetails: [],
    },
    support: {
      supportLabel: 'MNI152 2mm template',
      alignmentClass: 'same-grid',
      readyForCompare: true,
      severity: 'ok',
    },
    notes: [],
  },
};

const importedSet: SpatialFieldSetSummary = {
  ...demoSet,
  id: 'imported-set',
  sourceKind: 'imported',
};

const activeMember: StudioMemberSummary = {
  id: 'sub003',
  sourcePath: 'template:MNI152NLin2009cAsym_brain_2mm',
};

const compareCohort: StudioCohortSummary = {
  id: 'cohort-a',
  label: 'Matched controls',
  memberCount: 3,
  description: 'Seeded cohort',
  memberIds: ['sub001', 'sub002', 'sub003'],
  originKind: 'saved_snapshot',
  originLabel: 'Demo',
};

const activeExpression: StudioFieldExpressionSummary = {
  id: 'expr-z',
  label: 'Z-score',
  kind: 'comparison',
  recipe: 'zscore(current, cohort:cohort-a)',
  cohortId: 'cohort-a',
};

describe('buildStudioComparePaneSpecs', () => {
  it('seeds ready compare artifacts for demo sets', () => {
    const specs = buildStudioComparePaneSpecs({
      activeSet: demoSet,
      activeMember,
      compareCohort,
      activeExpression,
    });

    expect(specs.find((pane) => pane.id === 'current')?.binding?.sourcePath).toBe(
      'template:MNI152NLin2009cAsym_brain_2mm'
    );
    expect(specs.find((pane) => pane.id === 'cohort-mean')).toMatchObject({
      status: 'live',
      binding: {
        ready: true,
        sourcePath: 'template:MNI152NLin2009cAsym_GM_2mm',
        cacheStatus: 'hit',
        provenancePath: null,
      },
    });
    expect(specs.find((pane) => pane.id === 'residual')).toMatchObject({
      status: 'live',
      binding: {
        ready: true,
        sourcePath: 'template:MNI152NLin2009cAsym_WM_2mm',
        cacheStatus: 'hit',
      },
    });
    expect(specs.find((pane) => pane.id === 'zscore')).toMatchObject({
      status: 'live',
      binding: {
        ready: true,
        sourcePath: 'template:MNI152NLin2009cAsym_CSF_2mm',
        cacheStatus: 'hit',
      },
    });
  });

  it('keeps imported sets on the pending materialization path', () => {
    const specs = buildStudioComparePaneSpecs({
      activeSet: importedSet,
      activeMember,
      compareCohort,
      activeExpression,
    });

    expect(specs.find((pane) => pane.id === 'cohort-mean')).toMatchObject({
      status: 'pending',
      binding: {
        ready: false,
        sourcePath: null,
        cacheStatus: 'unavailable',
      },
    });
    expect(specs.find((pane) => pane.id === 'zscore')).toMatchObject({
      status: 'pending',
      binding: {
        ready: false,
        sourcePath: null,
        cacheStatus: 'unavailable',
      },
    });
  });

  it('marks fallback demo bindings as synthetic instead of cached', async () => {
    const service = new StudioCompareService({
      invoke: async () => {
        throw new Error('backend unavailable');
      },
    });

    const specs = await service.materializeComparePanes({
      activeSet: demoSet,
      activeMember,
      compareCohort,
      activeExpression,
    });

    expect(specs.find((pane) => pane.id === 'cohort-mean')).toMatchObject({
      status: 'live',
      binding: {
        ready: true,
        cacheStatus: 'synthetic',
      },
    });
    expect(specs.find((pane) => pane.id === 'cohort-mean')?.binding?.cacheMessage).toContain(
      'synthetic demo cohort preview'
    );
    expect(specs.find((pane) => pane.id === 'residual')?.binding?.cacheStatus).toBe('synthetic');
    expect(specs.find((pane) => pane.id === 'zscore')?.binding?.cacheStatus).toBe('synthetic');
  });
});
