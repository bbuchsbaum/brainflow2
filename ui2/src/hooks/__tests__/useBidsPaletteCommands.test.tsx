import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteDialog } from '@/components/dialogs/CommandPaletteDialog';
import { paletteView } from '@/components/dialogs/paletteView';
import { rankCommands } from '@/components/dialogs/commandPaletteMatch';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { deriveBidsModel } from '@/stores/bidsModel';
import { buildBidsPaletteCommands } from '../useBidsPaletteCommands';

const { openRunInViewer } = vi.hoisted(() => ({ openRunInViewer: vi.fn() }));
vi.mock('@/services/bids/openRunInViewer', () => ({ openRunInViewer }));

const dataset = createBidsBrowserDataset();
const RUN = 'sub-33_ses-02_task-nback_run-1_bold';

beforeEach(() => {
  openRunInViewer.mockClear();
  const index = dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({ index, exclusions: index.exclusions, scanStatus: 'ready' });
});

function palette(selected: string | null = null) {
  const commands = buildBidsPaletteCommands(selectBidsModel(useBidsStore.getState()), selected);
  const onClose = vi.fn();
  render(<CommandPaletteDialog open commands={commands} onClose={onClose} />);
  return { onClose, input: screen.getByLabelText('Command search') };
}

const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

describe('BIDS command palette', () => {
  it('finds runs, participants, findings and commands in that order', async () => {
    const { input } = palette(RUN);
    type(input, 'sub-33');
    await waitFor(() => expect(screen.getByText('Participants')).toBeInTheDocument());
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText(/more\. Keep typing/)).toBeInTheDocument();
    expect(screen.getAllByText(/^FD \d\.\d\d$/).length).toBeGreaterThan(0);
  });

  it('Tab selects the run; nothing opens', async () => {
    const { input, onClose } = palette();
    type(input, 'sub-33 ses-02 nback run-1');
    await screen.findByText('sub-33 ses-02 nback run-1');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(useBidsStore.getState().selectedRunId).toBe(RUN));
    expect(openRunInViewer).not.toHaveBeenCalled();
  });

  it('Enter opens the run in the viewer and does not select it', async () => {
    const { input } = palette();
    type(input, 'sub-33 ses-02 nback run-1');
    await screen.findByText('sub-33 ses-02 nback run-1');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(openRunInViewer).toHaveBeenCalledOnce());
    expect(openRunInViewer.mock.calls[0][0].id).toBe(RUN);
    expect(useBidsStore.getState().selectedRunId).toBeNull();
  });

  it('a click selects a run', async () => {
    const { input } = palette();
    type(input, 'sub-33 ses-02 nback run-1');
    fireEvent.click(await screen.findByText('sub-33 ses-02 nback run-1'));
    await waitFor(() => expect(useBidsStore.getState().selectedRunId).toBe(RUN));
    expect(openRunInViewer).not.toHaveBeenCalled();
  });

  it('a participant has no select: click and Enter set its lens, Tab keeps focus order', async () => {
    const { input } = palette();
    type(input, 'patient');
    await screen.findByText('Participants');
    const event = fireEvent.keyDown(input, { key: 'Tab' });
    // Not prevented: an entry without `select` leaves Tab to the browser.
    expect(event).toBe(true);
    fireEvent.click((await screen.findAllByText(/^patient · /))[0]);
    await waitFor(() => expect(useBidsStore.getState().lens).not.toBeNull());
    // Selection follows into the lens (native test 12).
    const { lens } = selectBidsModel(useBidsStore.getState());
    expect(useBidsStore.getState().selectedRunId).toBe(lens.bold[0].run.id);
  });

  it('selecting a run hidden by "only" shows the whole matrix again', async () => {
    act(() => {
      useBidsStore.getState().setLens({ id: 'l', label: 'l', predicate: { op: 'subjects', ids: ['01'] } });
      useBidsStore.getState().setLensMode('only');
    });
    const commands = buildBidsPaletteCommands(selectBidsModel(useBidsStore.getState()), null);
    commands.find((command) => command.id === `bids.run.${RUN}`)!.select!();
    expect(useBidsStore.getState().lensMode).toBe('highlight');
    expect(useBidsStore.getState().selectedRunId).toBe(RUN);
  });

  it('stays fast at 10,000 runs and draws only a capped list', () => {
    const large = createBidsBrowserDataset(650);
    const model = deriveBidsModel(large.index('s'));
    expect(model.runs.length).toBeGreaterThan(10000);
    const started = performance.now();
    const commands = buildBidsPaletteCommands(model, null);
    const built = performance.now();
    const view = paletteView(rankCommands(commands, 'sub-333 nback run-1'), true);
    const ranked = performance.now();
    expect(view.visible.length).toBeLessThan(40);
    expect(view.visible[0].title).toContain('sub-333');
    expect(built - started).toBeLessThan(300);
    expect(ranked - built).toBeLessThan(400);
  });
});
