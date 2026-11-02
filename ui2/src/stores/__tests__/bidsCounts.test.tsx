import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidsExclusion, BidsExclusionContext } from '@brainflow/api';
import { BidsFindingsPanel } from '@/components/bids/BidsFindingsPanel';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { bidsStatusParts } from '@/hooks/useBidsStatusBridge';
import { setTransport } from '@/services/transport';
import { selectBidsModel, useBidsStore } from '../bidsStore';

/** The design's required test: every view agrees after exclude, undo and revert. */

const context: BidsExclusionContext = {
  source_version: null,
  fd_definition: null,
  fd_source: null,
  fd_threshold_mm: 0.25,
};
const RUN = 'sub-07_ses-01_task-mid_run-2_bold';
const row: BidsExclusion = {
  entity: 'sub-07',
  scope: 'participant',
  reason: 'r',
  criterion: 'manual',
  value: '',
  author: 'a',
  date: 'd',
  source: '',
};

function snapshot() {
  const model = selectBidsModel(useBidsStore.getState());
  const shown = ['errors', 'content', 'variants', 'quality', 'notes'].map((id) =>
    Number(screen.queryByTestId(`bids-findings-count-${id}`)?.textContent ?? 0),
  );
  const parts = bidsStatusParts(model);
  return {
    statusFindings: parts.left[2],
    statusExcluded: parts.left[3],
    panelFindings: shown.reduce((sum, n) => sum + n, 0),
    panelExcluded: Number(screen.queryByTestId('bids-findings-count-excluded')?.textContent ?? 0),
    modelFindings: model.findings.total,
    excludedRuns: model.excluded.runs,
    excludedRows: model.excluded.rows,
    matrixRuns: model.columns.reduce((sum, column) => sum + column.total, 0),
    liveRuns: model.lens.ofRuns,
    allRuns: model.runs.length,
    participantQuality: model.findings.groups
      .find((group) => group.id === 'quality')!
      .items.filter((item) => item.entity.startsWith('sub-07')).length,
  };
}

function expectAgreement(view: ReturnType<typeof snapshot>) {
  expect(view.statusFindings).toBe(`Findings ${view.modelFindings}`);
  expect(view.panelFindings).toBe(view.modelFindings);
  expect(view.statusExcluded).toBe(`Excluded ${view.excludedRuns} run${view.excludedRuns === 1 ? '' : 's'}`);
  expect(view.panelExcluded).toBe(view.excludedRows);
  expect(view.matrixRuns).toBe(view.liveRuns);
  expect(view.liveRuns + view.excludedRuns).toBe(view.allRuns);
}

describe('count consistency', () => {
  beforeEach(() => {
    const dataset = createBidsBrowserDataset(undefined, { seedExclusion: false });
    const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) =>
      cmd === 'write_bids_exclusions'
        ? dataset.writeExclusions(args.rows as BidsExclusion[])
        : dataset.revertExclusions(args.keys as BidsExclusionKey[]),
    );
    setTransport({ invoke } as never);
    const index = dataset.index('s');
    useBidsStore.getState().reset();
    useBidsStore.setState({
      index,
      exclusions: index.exclusions,
      exclusionsLoaded: true,
      datasetPath: index.dataset_path,
      scanStatus: 'ready',
    });
  });

  it('holds through exclude, undo, exclude and revert', async () => {
    render(<BidsFindingsPanel />);
    const start = snapshot();
    expectAgreement(start);
    expect(start.excludedRuns).toBe(0);

    await act(() =>
      useBidsStore.getState().writeExclusions([{ ...row, entity: RUN, scope: 'run' }], context),
    );
    const one = snapshot();
    expectAgreement(one);
    expect(one.excludedRuns).toBe(1);
    expect(one.matrixRuns).toBe(start.matrixRuns - 1);

    await act(() => useBidsStore.getState().undoExclusion());
    expect(snapshot()).toEqual(start);

    await act(() => useBidsStore.getState().writeExclusions([row], context));
    const participant = snapshot();
    expectAgreement(participant);
    expect(participant.excludedRows).toBe(1);
    expect(participant.excludedRuns).toBeGreaterThan(10);
    // The participant's quality findings leave with them, and none appear:
    // the tSNR baseline keeps excluded runs, so the cut does not move.
    expect(start.participantQuality).toBeGreaterThan(0);
    expect(participant.participantQuality).toBe(0);
    expect(participant.modelFindings).toBeLessThan(start.modelFindings);

    await act(() => useBidsStore.getState().revertExclusions([{ entity: 'sub-07', criterion: row.criterion }]));
    expect(snapshot()).toEqual(start);
  });
});
