import React, { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidsBrowserIndex, BidsRunRecord } from '@brainflow/api';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { deriveBidsModel } from '@/stores/bidsModel';
import { BidsCoverage } from '../BidsCoverage';
import {
  buildCoverageLayout,
  focusBand,
  paintRows,
  rowAt,
  stackLabels,
} from '../coverageGeometry';

const { openSelectedRun } = vi.hoisted(() => ({ openSelectedRun: vi.fn() }));
vi.mock('@/services/bids/openRunInViewer', () => ({ openSelectedRun }));

const SELECTED = 'sub-33_ses-02_task-nback_run-1_bold';
const path = (mark: string) =>
  screen.getByTestId('bids-coverage-matrix').querySelector(`[data-mark="${mark}"]`);

function load(index: BidsBrowserIndex) {
  useBidsStore.getState().reset();
  useBidsStore.setState({ index, exclusions: index.exclusions, scanStatus: 'ready', datasetPath: index.dataset_path });
}

/** 400 participants by 40 columns, by repeating the synthetic runs. */
function largeIndex(): BidsBrowserIndex {
  const base = createBidsBrowserDataset().index('big');
  const template = base.runs.filter((run) => run.subject === '01' && run.suffix === 'bold')[0];
  const subjects = Array.from({ length: 400 }, (_, i) => String(i + 1).padStart(3, '0'));
  const runs: BidsRunRecord[] = subjects.flatMap((subject) =>
    Array.from({ length: 40 }, (_, c) => ({
      ...template,
      id: `sub-${subject}_task-t_run-${c + 1}_bold`,
      subject,
      session: null,
      run: String(c + 1),
      series: 'task-t_bold',
    })),
  );
  const errorRun = `sub-200_task-t_run-5_bold`;
  return {
    ...base,
    subjects,
    runs,
    participants: [],
    participant_columns: [],
    variants: [],
    new_subjects: [],
    exclusions: [],
    derivative_status: [],
    findings: [
      {
        id: 'e', tag: 'validator', severity: 'error', code: 'X', title: 'Bad', detail: '',
        subject: '200', session: null, run_ids: [errorRun], file: null,
      },
    ],
  };
}

describe('BidsCoverage', () => {
  beforeEach(() => {
    openSelectedRun.mockClear();
    load(createBidsBrowserDataset().index('s'));
  });

  it('draws a mark layer per meaning, not an element per cell', () => {
    render(<BidsCoverage />);
    const matrix = screen.getByTestId('bids-coverage-matrix');
    for (const mark of ['spark', 'sparkHot', 'hairline', 'dash', 'variant', 'content', 'error', 'errorInk', 'struck', 'fdDot', 'fdDotHot', 'fdHollow']) {
      expect(path(mark), mark).not.toBeNull();
    }
    expect(matrix.querySelectorAll('[data-mark]').length).toBeLessThan(30);
    expect(screen.getByText('sub-39')).toBeInTheDocument();
    expect(screen.getAllByText('new')).toHaveLength(3);
    expect(screen.getByText('control')).toBeInTheDocument();
  });

  it('states the scale, the totals label and the session mean rule', () => {
    render(<BidsCoverage />);
    const model0 = selectBidsModel(useBidsStore.getState());
    expect(model0.sparkClip.runs).toBeGreaterThan(0);
    // The scale, and what it cuts off: never a silent clip.
    expect(
      screen.getByText(
        `bold cells: FD per volume, 0–1.4 mm, shared scale; ${model0.sparkClip.runs} clipped, max ${model0.sparkClip.maxMm.toFixed(2)} mm`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(`${model0.sparkClip.runs} clipped: tick where FD passes 1.4 mm`)).toBeInTheDocument();
    expect(document.querySelector('[data-mark="sparkClip"]')).not.toBeNull();
    expect(screen.getByText('session mean of run FD, mm')).toBeInTheDocument();
    expect(screen.getByText('excluded runs not counted')).toBeInTheDocument();
    expect(screen.getByText('runs present, of 40')).toBeInTheDocument();
    const totals = screen.getByTestId('bids-coverage-totals');
    const model = selectBidsModel(useBidsStore.getState());
    const shown = [...totals.querySelectorAll('text')].slice(1).map((t) => Number(t.textContent));
    expect(shown).toEqual(model.columns.map((c) => c.total));
  });

  it('names the hollow-dot group in the legend from the data', () => {
    render(<BidsCoverage />);
    expect(screen.getByTestId('bids-coverage-legend').textContent).toContain(
      'hollow FD dot: this session\'s runs are TR 1.0 s / MB 4, unlike most (TR 0.8 s / MB 6); FD is unfiltered, so compare within group',
    );
  });

  it('keeps the excluded strike and the totals in step with the store', () => {
    const before = selectBidsModel(useBidsStore.getState());
    const col = before.runPosition.get(SELECTED)!.col;
    render(<BidsCoverage />);
    const totalText = () =>
      screen.getByTestId('bids-coverage-totals').querySelectorAll('text')[col + 1].textContent;
    const first = totalText();
    act(() => {
      useBidsStore.setState({
        exclusions: [
          ...useBidsStore.getState().exclusions,
          { entity: SELECTED, scope: 'run', reason: '', criterion: 'x', value: '', author: '', date: '', source: '' },
        ],
      });
    });
    expect(Number(totalText())).toBe(Number(first) - 1);
  });

  it('selects by clicking a cell and opens on double click', () => {
    const model = selectBidsModel(useBidsStore.getState());
    render(<BidsCoverage />);
    const matrix = screen.getByTestId('bids-coverage-matrix');
    const layout = buildCoverageLayout(model);
    const at = model.runPosition.get(SELECTED)!;
    fireEvent.click(matrix, {
      clientX: layout.colX[at.col] + 5,
      clientY: layout.rowY[at.row] + 5,
    });
    expect(useBidsStore.getState().selectedRunId).toBe(SELECTED);
    fireEvent.doubleClick(matrix);
    expect(openSelectedRun).toHaveBeenCalledOnce();
  });

  it('marks selection with a fill and the amber edge, never an outline', () => {
    render(<BidsCoverage />);
    expect(screen.queryByTestId('bids-selected-edge')).toBeNull();
    act(() => useBidsStore.getState().selectRun(SELECTED));
    const edge = screen.getByTestId('bids-selected-edge');
    expect(edge.getAttribute('width')).toBe('2');
    expect(edge).toHaveClass('fill-bf-accent');
  });

  it('moves the selection without touching the base layer', () => {
    const commits = vi.fn();
    render(
      <Profiler id="coverage" onRender={commits}>
        <BidsCoverage />
      </Profiler>,
    );
    const spark = path('spark');
    const d = spark?.getAttribute('d');
    const before = commits.mock.calls.length;
    act(() => useBidsStore.getState().selectRun(SELECTED));
    act(() => useBidsStore.getState().moveSelection('down'));
    expect(path('spark')).toBe(spark);
    expect(path('spark')?.getAttribute('d')).toBe(d);
    // The scene commits; the model is untouched, so the top component does not re-derive.
    expect(commits.mock.calls.length).toBe(before + 2);
    expect(selectBidsModel(useBidsStore.getState()).runPosition.size).toBeGreaterThan(0);
  });
});

describe('BidsCoverage at 400 participants', () => {
  const index = largeIndex();

  beforeEach(() => load(index));

  it('compresses rows and keeps the DOM small', () => {
    const started = performance.now();
    render(<BidsCoverage />);
    const elapsed = performance.now() - started;
    expect(screen.getByTestId('bids-coverage').dataset.compressed).toBe('true');
    const matrix = screen.getByTestId('bids-coverage-matrix');
    expect(matrix.querySelectorAll('*').length).toBeLessThan(120);
    expect(path('spark')).toBeNull();
    expect(path('quiet')).not.toBeNull();
    expect(path('fdTick')).not.toBeNull();
    expect(path('error')).not.toBeNull();
    expect(elapsed).toBeLessThan(2500);
  });

  it('keeps an error shape at 3 px: full height with an ink notch', () => {
    const model = selectBidsModel(useBidsStore.getState());
    const layout = buildCoverageLayout(model);
    expect(layout.rowPx).toBe(3);
    const paths = paintRows(model, layout, [{ row: 199, y: 0, height: 3 }]);
    expect(paths.error).toMatch(/v3/);
    expect(paths.errorInk).not.toBe('');
    expect(paths.quiet).toMatch(/v2/);
  });

  it('opens a graduated 16 px band with sparklines only inside it', () => {
    render(<BidsCoverage />);
    act(() => useBidsStore.getState().selectRun('sub-200_task-t_run-7_bold'));
    const band = screen.getByTestId('bids-focus-band');
    expect(band.querySelector('[data-mark="spark"], [data-mark="sparkHot"]')).not.toBeNull();
    const model = selectBidsModel(useBidsStore.getState());
    const layout = buildCoverageLayout(model);
    const rows = focusBand(layout, model.rows.length, 199).rows;
    expect(rows.map((r) => r.height)).toEqual([5, 5, 5, 10, 10, 10, 16, 10, 10, 10, 5, 5, 5]);
    expect(screen.getByTestId('bids-coverage-matrix').querySelector('defs [data-mark="spark"]')).toBeNull();
    expect(band.querySelectorAll('text')).toHaveLength(7);
  });

  it('moves the band without repainting the base layer', () => {
    render(<BidsCoverage />);
    const quiet = path('quiet');
    const d = quiet?.getAttribute('d');
    act(() => useBidsStore.getState().selectRun('sub-200_task-t_run-7_bold'));
    act(() => useBidsStore.getState().moveSelection('down'));
    expect(path('quiet')).toBe(quiet);
    expect(path('quiet')?.getAttribute('d')).toBe(d);
  });

  it('clicks through the band and below it to the right rows', () => {
    render(<BidsCoverage />);
    act(() => useBidsStore.getState().selectRun('sub-200_task-t_run-7_bold'));
    const model = selectBidsModel(useBidsStore.getState());
    const layout = buildCoverageLayout(model);
    const band = focusBand(layout, model.rows.length, 199);
    const matrix = screen.getByTestId('bids-coverage-matrix');
    fireEvent.click(matrix, { clientX: layout.colX[0] + 5, clientY: layout.rowY[300] + band.extra + 1 });
    expect(useBidsStore.getState().selectedRunId).toBe('sub-301_task-t_run-1_bold');
  });
});

describe('coverage geometry', () => {
  it('finds rows and skips group headers', () => {
    const model = deriveBidsModel(createBidsBrowserDataset().index('s'));
    const layout = buildCoverageLayout(model);
    expect(rowAt(layout, 1)).toBeNull();
    expect(rowAt(layout, layout.rowY[3] + 15)).toBe(3);
  });

  it('keeps every row on the 16 px grid so scrolling snaps to whole rows', () => {
    const layout = buildCoverageLayout(deriveBidsModel(createBidsBrowserDataset().index('s')));
    expect(layout.rowY.every((y) => y % 16 === 0)).toBe(true);
  });

  it('stacks crowded labels on horizontal lines', () => {
    const placed = stackLabels(
      [
        { text: 'nback', x: 0 },
        { text: 'mid', x: 15 },
        { text: 'rest', x: 30 },
        { text: 'dwi', x: 80 },
      ],
      6,
      3,
    );
    expect(placed.map((label) => label.line)).toEqual([0, 1, 2, 0]);
  });
});
