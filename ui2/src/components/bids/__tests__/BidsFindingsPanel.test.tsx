import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidsExclusion, BidsExclusionKey } from '@brainflow/api';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { setTransport } from '@/services/transport';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { BidsFindingsPanel } from '../BidsFindingsPanel';

function load() {
  const dataset = createBidsBrowserDataset();
  setTransport({
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) =>
      cmd === 'revert_bids_exclusions'
        ? dataset.revertExclusions(args.keys as BidsExclusionKey[])
        : dataset.writeExclusions(args.rows as BidsExclusion[]),
    ),
  } as never);
  const index = dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({
    index,
    exclusions: index.exclusions,
    exclusionsLoaded: true,
    datasetPath: index.dataset_path,
    scanStatus: 'ready',
  });
}

const model = () => selectBidsModel(useBidsStore.getState());

beforeEach(load);

describe('BidsFindingsPanel', () => {
  it('lists the groups in design order with their counts, one count overall', () => {
    render(<BidsFindingsPanel />);
    const groups = screen.getAllByRole('region').slice(1);
    expect(groups.map((node) => node.getAttribute('aria-label'))).toEqual([
      'Errors',
      'Content problems',
      'Acquisition variants',
      'Quality',
      'Notes',
      'Excluded',
    ]);
    const counted = ['errors', 'content', 'variants', 'quality', 'notes'].map((id) =>
      Number(screen.getByTestId(`bids-findings-count-${id}`).textContent),
    );
    expect(counted.reduce((sum, n) => sum + n, 0)).toBe(model().status.findings);
  });

  it('keeps validator and Brainflow tags apart', () => {
    render(<BidsFindingsPanel />);
    const errors = screen.getByRole('region', { name: 'Errors' }).textContent;
    expect(errors).toContain('sub-35 ses-01 · validator');
    expect(errors).toContain('sub-04 ses-02 · brainflow check');
  });

  it('a click sets the lens, a second clears it, and the detail shows while selected', () => {
    render(<BidsFindingsPanel />);
    const row = screen.getByText('Missing .bvec').closest('[data-testid="bids-finding-row"]')!;
    fireEvent.click(row);
    expect(useBidsStore.getState().lens?.label).toBe('Missing .bvec');
    expect(screen.getByText(/has a .bval but no .bvec/)).toBeInTheDocument();
    fireEvent.click(row);
    expect(useBidsStore.getState().lens).toBeNull();
  });

  it('shows saved lenses first, with delete and a lens list to copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    act(() => {
      useBidsStore.getState().setLens({ id: 'l', label: 'x', predicate: { op: 'task', id: 'nback' } });
      useBidsStore.getState().saveLens('Task nback');
    });
    render(<BidsFindingsPanel />);
    const saved = screen.getByRole('region', { name: 'Saved lenses' });
    expect(screen.getAllByRole('region')[1]).toBe(saved);
    expect(saved.textContent).toContain('Task nback');
    expect(saved.textContent).toContain(`${model().lens.runs.length} of ${model().lens.ofRuns} runs`);
    fireEvent.click(within(saved).getByRole('button', { name: /Copy lens list/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const lines = (writeText.mock.calls[0][0] as string).split('\n');
    expect(lines[0]).toBe('participant_id\tsession_id\trun_id\tpath');
    expect(lines).toHaveLength(model().lens.runs.length + 1);
    fireEvent.click(within(saved).getByRole('button', { name: /Delete saved lens/ }));
    expect(useBidsStore.getState().savedLenses).toHaveLength(0);
  });

  it('Review lenses the excluded runs and Revert returns them to every count', async () => {
    render(<BidsFindingsPanel />);
    const before = model().excluded.runs;
    expect(before).toBe(1);
    const entity = useBidsStore.getState().exclusions[0].entity;
    fireEvent.click(screen.getByRole('button', { name: `Review ${entity}` }));
    expect(model().lens.runs.map((item) => item.run.id)).toEqual([entity]);
    expect(useBidsStore.getState().selectedRunId).toBe(entity);
    fireEvent.click(screen.getByRole('button', { name: `Revert ${entity}` }));
    await waitFor(() => expect(model().excluded.runs).toBe(0));
    expect(screen.queryByTestId('bids-excluded-row')).toBeNull();
  });

  it('offers the censoring fraction through setCensor', () => {
    render(<BidsFindingsPanel />);
    const [offer] = screen.getAllByTestId('bids-censor-offer');
    const first = model().censorOffers[0];
    expect(offer.textContent).toContain(`${first.runsOver} of ${first.ofRuns}`);
    fireEvent.click(offer);
    expect(useBidsStore.getState().censor).toEqual({ lineMm: 0.2, maxFraction: 0.2 });
    expect(screen.getByRole('region', { name: 'Quality' }).textContent).toContain('excluded runs not counted');
    fireEvent.click(screen.getAllByTestId('bids-censor-offer')[0]);
    expect(useBidsStore.getState().censor).toBeNull();
  });

  it('says so while the scan is partial', () => {
    const dataset = createBidsBrowserDataset();
    act(() => useBidsStore.setState({ index: dataset.partial('p', 3) }));
    render(<BidsFindingsPanel />);
    expect(screen.getByText(/So far: findings update/)).toBeInTheDocument();
  });
});

describe('findings by rule', () => {
  it('shows one line per rule, participant and session first when opened', () => {
    useBidsStore.setState({ index: createBidsBrowserDataset().index('rules'), datasetPath: '/d' } as never);
    render(<BidsFindingsPanel />);
    const quality = selectBidsModel(useBidsStore.getState()).findings.groups.find((g) => g.id === 'quality')!;
    const fd = quality.rules.find((rule) => rule.items[0].kind === 'fd')!;
    expect(fd.items.length).toBeGreaterThan(1);
    const row = screen.getByText(fd.title).closest('[data-testid="bids-finding-rule"]') as HTMLElement;
    expect(within(row).getByText(`${fd.items.length} sessions`)).toBeInTheDocument();
    expect(within(row).queryAllByTestId('bids-finding-entity')).toHaveLength(0);
    fireEvent.click(within(row).getByRole('button', { name: new RegExp(`^Show ${fd.items.length} sessions`) }));
    const entities = within(row).getAllByTestId('bids-finding-entity');
    expect(entities).toHaveLength(fd.items.length);
    expect(entities[0].textContent).toBe(`${fd.items[0].entity} · ${fd.items[0].value}`);
  });

  it('a rule sets a lens over all its runs, and selects the first', () => {
    useBidsStore.setState({ index: createBidsBrowserDataset().index('rules'), datasetPath: '/d' } as never);
    render(<BidsFindingsPanel />);
    const quality = selectBidsModel(useBidsStore.getState()).findings.groups.find((g) => g.id === 'quality')!;
    const fd = quality.rules.find((rule) => rule.items[0].kind === 'fd')!;
    fireEvent.click(screen.getByText(fd.title));
    const state = useBidsStore.getState();
    expect(state.lens?.id).toBe(fd.lens!.id);
    expect(selectBidsModel(state).lens.bold.some((facts) => facts.run.id === state.selectedRunId)).toBe(true);
  });
});
