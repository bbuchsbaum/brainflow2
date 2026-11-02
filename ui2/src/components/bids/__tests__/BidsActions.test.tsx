import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidsExclusion, BidsExclusionKey } from '@brainflow/api';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { getLayoutService } from '@/services/layoutService';
import { setTransport } from '@/services/transport';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { exclusionTsvHeader, exclusionTsvLine } from '@/stores/bidsExclusions';
import { BidsActionHost } from '../BidsActionHost';

const OVER = 'sub-07_ses-01_task-mid_run-2_bold';
const AUTHOR_KEY = 'brainflow.bids.author';

function backend(seed = false) {
  const dataset = createBidsBrowserDataset(undefined, { seedExclusion: seed });
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case 'write_bids_exclusions':
        return dataset.writeExclusions(args.rows as BidsExclusion[]);
      case 'revert_bids_exclusions':
        return dataset.revertExclusions(args.keys as BidsExclusionKey[]);
      case 'get_bids_slice':
        return { png_base64: 'AAAA', width: 1, height: 1, world_z_mm: 4, window_low: 0, window_high: 1, volumes_used: 8 };
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  });
  setTransport({ invoke } as never);
  const index = dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({
    index,
    exclusions: index.exclusions,
    exclusionsLoaded: true,
    datasetPath: index.dataset_path,
    scanStatus: 'ready',
    selectedRunId: OVER,
  });
  return invoke;
}

const model = () => selectBidsModel(useBidsStore.getState());

function openDialog() {
  render(<BidsActionHost />);
  act(() => useBidsStore.getState().requestAction('exclude'));
}

const written = (invoke: ReturnType<typeof backend>) =>
  invoke.mock.calls.find(([cmd]) => cmd === 'write_bids_exclusions')![1] as {
    rows: BidsExclusion[];
    context: Record<string, unknown>;
  };

beforeEach(() => {
  localStorage.removeItem(AUTHOR_KEY);
});

describe('exclude dialog', () => {
  it('prefills the reason from the criterion and previews the exact row it writes', async () => {
    const invoke = backend();
    openDialog();
    const reason = screen.getByLabelText('Reason') as HTMLInputElement;
    expect(reason.value).toMatch(/^Mean FD 0\.\d\d mm, over the 0\.25 mm threshold$/);
    const preview = screen.getByTestId('bids-exclude-preview').textContent;
    fireEvent.click(screen.getByRole('button', { name: /Exclude ↵/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const { rows, context } = written(invoke);
    expect(rows).toHaveLength(1);
    expect(`${exclusionTsvHeader}\n${exclusionTsvLine(rows[0])}`).toBe(preview);
    expect(context).toEqual({ source_version: '1.2.0' });
    expect(useBidsStore.getState().undoStack).toHaveLength(1);
  });

  it('keeps an edited reason, escaped as the writer escapes it', async () => {
    const invoke = backend();
    openDialog();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'asleep\tagain' } });
    expect(screen.getByTestId('bids-exclude-preview').textContent).toContain('asleep\\tagain');
    fireEvent.submit(screen.getByTestId('bids-exclude-dialog'));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(written(invoke).rows[0].reason).toBe('asleep\tagain');
  });

  it('writes the entity of the chosen scope and counts its runs', async () => {
    const invoke = backend();
    openDialog();
    const expected = model().runs.filter(({ run }) => run.subject === '07' && run.session === '01').length;
    fireEvent.click(screen.getByRole('radio', { name: `All ${expected} runs in ses-01` }));
    expect(screen.getByTestId('bids-exclude-preview').textContent).toContain('sub-07_ses-01\t');
    fireEvent.submit(screen.getByTestId('bids-exclude-dialog'));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(written(invoke).rows[0].entity).toBe('sub-07_ses-01');
    await waitFor(() => expect(model().excluded.runs).toBe(expected));
  });

  it('offers the censoring fraction beside mean FD and says what excluded runs do', () => {
    backend();
    openDialog();
    const dialog = screen.getByRole('dialog');
    const fd = useBidsStore.getState().index!.runs.find((run) => run.id === OVER)!.fd!;
    const percent = Math.round((fd.over_0_5 / fd.n_frames) * 100);
    const option = within(dialog).getByRole('option', {
      name: `${percent}% of frames over 0.5 mm (limit 20%)`,
    }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText('Criterion'), { target: { value: option.value } });
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toContain(
      `${percent}% of frames over 0.5 mm`,
    );
    expect(screen.getByTestId('bids-exclude-preview').textContent).toContain('fd_frames_over_0.5>0.2');
    expect(dialog.textContent).toContain('Session means: excluded runs not counted.');
  });

  it('shows the description only before the first write', () => {
    backend();
    openDialog();
    expect(screen.getByTestId('bids-exclude-description').textContent).toContain('"DatasetType": "derivative"');
    expect(screen.getByTestId('bids-exclude-description').textContent).toContain('"DOI":"doi:10.18112/example.v1.2.0"');
  });

  it('leaves the description out once exclusions exist', () => {
    backend(true);
    openDialog();
    expect(screen.queryByTestId('bids-exclude-description')).toBeNull();
  });

  it('remembers an edited author', async () => {
    const invoke = backend();
    openDialog();
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'B. Buchsbaum' } });
    fireEvent.submit(screen.getByTestId('bids-exclude-dialog'));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(localStorage.getItem(AUTHOR_KEY)).toBe('B. Buchsbaum');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => useBidsStore.getState().requestAction('exclude'));
    expect((screen.getByLabelText('Author') as HTMLInputElement).value).toBe('B. Buchsbaum');
  });

  it('refuses a remote mount and shows a failed write', async () => {
    const invoke = backend();
    const index = useBidsStore.getState().index!;
    act(() => useBidsStore.setState({ index: { ...index, is_remote: true } }));
    openDialog();
    expect(screen.getByRole('button', { name: /Exclude ↵/ })).toBeDisabled();
    expect(screen.getByRole('dialog').textContent).toContain('cannot be written on a remote mount');
    act(() => useBidsStore.setState({ index: { ...index, is_remote: false } }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    invoke.mockRejectedValueOnce(new Error('disk full'));
    act(() => useBidsStore.getState().requestAction('exclude'));
    fireEvent.submit(screen.getByTestId('bids-exclude-dialog'));
    expect(await screen.findByText(/Nothing was written: disk full/)).toBeInTheDocument();
    expect(model().excluded.runs).toBe(0);
  });

  it('asks for a reason when no criterion is over', () => {
    backend();
    act(() => useBidsStore.setState({ selectedRunId: 'sub-01_ses-01_T1w' }));
    openDialog();
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Exclude ↵/ })).toBeDisabled();
  });
});

describe('action host', () => {
  it('does nothing without a selected run', () => {
    backend();
    act(() => useBidsStore.setState({ selectedRunId: null }));
    render(<BidsActionHost />);
    act(() => useBidsStore.getState().requestAction('quick-look'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useBidsStore.getState().actionRequest).toBeNull();
  });

  it('quick look shows a larger slice and Escape closes it', async () => {
    const invoke = backend();
    render(<BidsActionHost />);
    act(() => useBidsStore.getState().requestAction('quick-look'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await screen.findByTestId('bids-quick-look-caption');
    const call = invoke.mock.calls.find(([cmd]) => cmd === 'get_bids_slice')!;
    expect((call[1] as { request: { max_px: number } }).request.max_px).toBe(512);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('compare toggles and reveals the Inspector', () => {
    backend();
    const showPanel = vi.spyOn(getLayoutService(), 'showPanel').mockReturnValue(true);
    render(<BidsActionHost />);
    act(() => useBidsStore.getState().requestAction('compare'));
    expect(useBidsStore.getState().compareWithModal).toBe(true);
    expect(showPanel).toHaveBeenCalledWith('Inspector');
    act(() => useBidsStore.getState().requestAction('compare'));
    expect(useBidsStore.getState().compareWithModal).toBe(false);
    showPanel.mockRestore();
  });
});
