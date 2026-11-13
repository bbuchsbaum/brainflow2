import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetMarker } from '@brainflow/api';
import { FileTreeItemRow, FileTreeRow } from '../files/FileTreeRow';
import { ContextMenu } from '@/components/ui/ContextMenu';
import {
  MARKER_DEBOUNCE_MS,
  MARKER_RETRY_AFTER_FAILURE_MS,
  resetDatasetCardServiceForTests,
} from '@/services/DatasetCardService';
import { setTransport } from '@/services/transport';
import { markerKey, useDatasetCardStore } from '@/stores/datasetCardStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';

vi.mock('@/services/studio/SetStudioService', () => ({
  getSetStudioService: () => ({ openFolderOntologyInStudio: vi.fn() }),
}));
vi.mock('@/services/ImageSetService', () => ({
  getImageSetService: () => ({ openFolder: vi.fn() }),
}));

const ROOT = '/data/pcmri';
const GLM = `${ROOT}/derivatives/glm_recog`;

function marker(path: string, patch: Partial<DatasetMarker> = {}): DatasetMarker {
  return {
    path,
    hasDescription: true,
    analysisCount: null,
    analysisCountTruncated: false,
    summary: {
      name: 'Recognition GLM, first and group level',
      datasetType: 'derivative',
      generatedBy: { name: 'fmrireg', version: '0.4.1' },
    },
    issue: null,
    ...patch,
  };
}

const answers = new Map<string, DatasetMarker>();
const defaultInvoke = async (cmd: string, args?: unknown): Promise<unknown> => {
  const record = (args ?? {}) as { paths?: string[]; path?: string };
  if (cmd === 'probe_dataset_markers') {
    return (record.paths ?? []).map(
      (path) => answers.get(path) ?? marker(path, { hasDescription: false, summary: null }),
    );
  }
  if (cmd === 'check_bids_directory') return false;
  if (cmd === 'get_dataset_card' || cmd === 'get_sidecar_card') return new Promise(() => {});
  return undefined;
};
const invoke = vi.fn(defaultInvoke);
const commands = () => invoke.mock.calls.map(([cmd]) => cmd);

/** A react-arborist node as the row reads it: `ROOT` is the level-0 ancestor. */
function node(path: string, type: 'file' | 'directory', level = 2) {
  const root = { level: 0, data: { path: ROOT }, parent: null };
  return {
    data: { id: `${ROOT}::${path}`, path, name: path.split('/').pop() ?? path, type },
    level,
    isOpen: false,
    toggle: vi.fn(),
    handleClick: vi.fn(),
    parent: level === 0 ? null : { level: 1, data: { path: `${ROOT}/x` }, parent: root },
  };
}

function Row({ path, type = 'directory' as const }: { path: string; type?: 'file' | 'directory' }) {
  const n = node(path, type);
  return (
    <FileTreeItemRow
      node={n as never}
      attrs={{ role: 'treeitem', tabIndex: 0 } as never}
      innerRef={() => {}}
      children={
        <FileTreeRow node={n as never} style={{}} tree={{} as never} dragHandle={() => {}} />
      }
    />
  );
}

async function renderRow(path: string, type: 'file' | 'directory' = 'directory') {
  const view = render(
    <>
      <Row path={path} type={type} />
      <ContextMenu />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MARKER_DEBOUNCE_MS + 1);
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetDatasetCardServiceForTests();
  answers.clear();
  invoke.mockClear();
  setTransport({ invoke } as never);
  useFileBrowserStore.setState({ selectedPath: null, searchQuery: '' });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('dataset marker on a folder row', () => {
  it('asks for the marker because the row is rendered, with its browse root', async () => {
    answers.set(GLM, marker(GLM));
    await renderRow(GLM);
    expect(invoke).toHaveBeenCalledWith('probe_dataset_markers', { paths: [GLM], rootPath: ROOT });
  });

  it('shows a page-icon button for a folder with a description', async () => {
    answers.set(GLM, marker(GLM));
    const { container } = await renderRow(GLM);
    const button = screen.getByRole('button', { name: 'Show dataset description for glm_recog' });
    expect(button).toHaveAttribute('data-dataset-marker', 'description');
    expect(button.querySelector('svg')).not.toBeNull();
    // One tab stop for the tree: the marker is reached by pointer or by Space on the row.
    expect(button).toHaveAttribute('tabindex', '-1');
    const treeitem = container.querySelector('[role="treeitem"]');
    expect(treeitem).toHaveAttribute('aria-label', 'glm_recog');
    expect(treeitem).toHaveAttribute(
      'aria-description',
      'Has a dataset description. Press Space to show it.',
    );
    expect(treeitem).toHaveAttribute('data-fs-path', GLM);
  });

  it('shows "N analyses" in place of the icon for a folder of analyses', async () => {
    const path = `${ROOT}/derivatives`;
    answers.set(path, marker(path, { hasDescription: false, analysisCount: 4, summary: null }));
    await renderRow(path);
    const button = screen.getByRole('button', { name: 'Show the 4 analyses in derivatives' });
    expect(button).toHaveTextContent(/^4 analyses$/);
    expect(button.querySelector('svg')).toBeNull();
  });

  it('writes a truncated analysis count as a floor', async () => {
    const path = `${ROOT}/derivatives`;
    answers.set(path, marker(path, { analysisCount: 64, analysisCountTruncated: true }));
    await renderRow(path);
    expect(
      screen.getByRole('button', { name: 'Show the at least 64 analyses in derivatives' }),
    ).toHaveTextContent('64+ analyses');
  });

  it('keeps the space between a floor and its unit, and says "at least" in the hover summary', async () => {
    const path = `${ROOT}/derivatives`;
    answers.set(
      path,
      marker(path, { hasDescription: false, analysisCount: 24, analysisCountTruncated: true }),
    );
    const { container } = await renderRow(path);
    const button = screen.getByRole('button', { name: /24 analyses in derivatives/ });
    // The button is a flex box: the count and its unit share one inline child,
    // or the space between them would be dropped ("24+analyses").
    expect(button.children).toHaveLength(1);
    expect(button.firstElementChild).toHaveTextContent(/^24\+ analyses$/);
    expect(button.firstElementChild?.textContent).toBe('24+ analyses');

    fireEvent.mouseEnter(container.querySelector('.file-tree-item') as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const tip = screen.getByRole('tooltip');
    // A floor in words, so it cannot be read against the card's own count.
    expect(tip).toHaveTextContent('Contains');
    expect(tip).toHaveTextContent('at least 24 analyses');
    expect(tip).not.toHaveTextContent('24+');
  });

  it('shows nothing for a folder without a description, and never probes a file row', async () => {
    const { unmount, container } = await renderRow(`${ROOT}/derivatives/rsa_item`);
    expect(container.querySelector('[data-dataset-marker]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).not.toHaveAttribute('aria-description');
    expect(screen.getByText('rsa_item').closest('.file-tree-item')).toHaveAttribute(
      'title',
      'rsa_item',
    );
    unmount();
    invoke.mockClear();
    await renderRow(`${ROOT}/sub-01/anat/T1w.nii.gz`, 'file');
    expect(commands()).not.toContain('probe_dataset_markers');
    expect(document.querySelector('[data-dataset-marker]')).toBeNull();
  });

  it('hover shows a summary built from the marker alone, with no backend call', async () => {
    answers.set(GLM, marker(GLM));
    const prefetch = vi.fn();
    useFileBrowserStore.setState({ prefetchDirectory: prefetch } as never);
    const { container } = await renderRow(GLM);
    const row = container.querySelector('.file-tree-item') as HTMLElement;
    // The custom summary replaces the native tooltip on a marked row.
    expect(row).not.toHaveAttribute('title');
    invoke.mockClear();

    fireEvent.mouseEnter(row);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Recognition GLM, first and group level');
    expect(tip).toHaveTextContent('pcmri/derivatives/glm_recog');
    expect(tip).toHaveTextContent('Generated by');
    expect(tip).toHaveTextContent('fmrireg 0.4.1');
    expect(tip).toHaveTextContent('Derivative');
    expect(tip).toHaveTextContent('Click the page icon or press Space for the full description');
    // Counts and spaces need the folder walked: they are the card's, not the hover's.
    expect(tip).not.toHaveTextContent(/subjects|Space\b(?! for)/);
    expect(screen.getByRole('button', { name: /Show dataset description/ })).toHaveAttribute(
      'aria-describedby',
      tip.id,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.mouseLeave(row);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows no hover summary while a card is pinned', async () => {
    answers.set(GLM, marker(GLM));
    const { container } = await renderRow(GLM);
    const row = container.querySelector('.file-tree-item') as HTMLElement;
    const hover = async () => {
      fireEvent.mouseEnter(row);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
    };
    await hover();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // The card of some other row: the summary would sit on the same layer.
    act(() =>
      useDatasetCardStore.setState({
        card: {
          kind: 'dataset',
          rootPath: ROOT,
          path: `${ROOT}/elsewhere`,
          originPath: `${ROOT}/elsewhere`,
          status: 'loading',
          dataset: null,
          sidecar: null,
          error: null,
          backStack: [],
        },
      }),
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: /Show dataset description/ })).not.toHaveAttribute(
      'aria-describedby',
    );
    fireEvent.mouseLeave(row);
    await hover();
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => useDatasetCardStore.setState({ card: null }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('keeps the count apart from its unit, so a narrow row can show the count alone', async () => {
    const path = `${ROOT}/derivatives`;
    answers.set(path, marker(path, { analysisCount: 64, analysisCountTruncated: true }));
    await renderRow(path);
    const button = screen.getByRole('button', { name: /64 analyses in derivatives/ });
    const unit = button.querySelector('.dataset-marker-unit') as HTMLElement;
    expect(unit).toHaveTextContent('analyses');
    // What is left when the stylesheet hides the unit in a narrow panel.
    unit.remove();
    expect(button).toHaveTextContent(/^64\+$/);
    expect(button).toHaveAccessibleName('Show the at least 64 analyses in derivatives');
  });

  it('gets its marker after a probe that failed, without being rendered again', async () => {
    let fail = true;
    answers.set(GLM, marker(GLM));
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== 'probe_dataset_markers') return undefined;
      if (fail) throw { Io: { code: 8263, details: 'unreadable' } };
      return ((args as { paths: string[] }).paths ?? []).map((path) => answers.get(path));
    });
    try {
      await renderRow(GLM);
      expect(document.querySelector('[data-dataset-marker]')).toBeNull();
      fail = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MARKER_RETRY_AFTER_FAILURE_MS + MARKER_DEBOUNCE_MS + 2);
      });
      expect(screen.getByRole('button', { name: /Show dataset description/ })).toBeInTheDocument();
      expect(commands().filter((cmd) => cmd === 'probe_dataset_markers')).toHaveLength(2);
    } finally {
      invoke.mockImplementation(defaultInvoke);
    }
  });

  it('falls back to the folder name when the description has no Name', async () => {
    const path = `${ROOT}/derivatives`;
    answers.set(path, marker(path, { analysisCount: 4, summary: null }));
    const { container } = await renderRow(path);
    fireEvent.mouseEnter(container.querySelector('.file-tree-item') as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('derivatives');
    expect(tip).toHaveTextContent('4 analyses');
    expect(tip).not.toHaveTextContent('Generated by');
    expect(tip).toHaveTextContent('Click the count or press Space for the list of analyses');
  });

  it('clicking the marker opens the pinned card and selects the folder, without toggling it', async () => {
    answers.set(GLM, marker(GLM));
    await renderRow(GLM);
    invoke.mockClear();
    const button = screen.getByRole('button', { name: /Show dataset description/ });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(useDatasetCardStore.getState().card).toMatchObject({
      kind: 'dataset',
      rootPath: ROOT,
      path: GLM,
      originPath: GLM,
    });
    expect(invoke).toHaveBeenCalledWith(
      'get_dataset_card',
      expect.objectContaining({ path: GLM, rootPath: ROOT }),
    );
    expect(useFileBrowserStore.getState().selectedPath).toBe(GLM);
  });

  it('reads the marker from the store without asking again while it is fresh', async () => {
    useDatasetCardStore.setState({
      markers: { [markerKey(ROOT, GLM)]: { marker: marker(GLM), fetchedAtMs: Date.now() } },
    });
    await renderRow(GLM);
    expect(commands()).not.toContain('probe_dataset_markers');
    expect(screen.getByRole('button', { name: /Show dataset description/ })).toBeInTheDocument();
  });

  it('offers the card from the folder context menu', async () => {
    answers.set(GLM, marker(GLM));
    await renderRow(GLM);
    fireEvent.contextMenu(screen.getByText('glm_recog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show description' }));
    });
    expect(useDatasetCardStore.getState().card).toMatchObject({ kind: 'dataset', path: GLM });
    // The existing folder actions are still there.
    fireEvent.contextMenu(screen.getByText('glm_recog'));
    expect(screen.getByRole('menuitem', { name: 'Open in Set studio…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Expand' })).toBeInTheDocument();
  });
});

describe('sidecar metadata on an image row', () => {
  it('offers "Show metadata" for an image file and opens the sidecar card', async () => {
    const file = `${GLM}/sub-01/sub-01_task-recog_stat-beta.nii.gz`;
    await renderRow(file, 'file');
    fireEvent.contextMenu(screen.getByText(/stat-beta/));
    for (const name of ['Open', 'Add as layer', 'Open in new tab', 'Open in comparison view']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show metadata' }));
    });
    expect(useDatasetCardStore.getState().card).toMatchObject({
      kind: 'sidecar',
      rootPath: ROOT,
      path: file,
    });
    expect(invoke).toHaveBeenCalledWith(
      'get_sidecar_card',
      expect.objectContaining({ path: file, rootPath: ROOT }),
    );
  });

  it('does not offer it for a file that is not an image', async () => {
    await renderRow(`${GLM}/participants.tsv`, 'file');
    fireEvent.contextMenu(screen.getByText('participants.tsv'));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Show metadata' })).toBeNull();
  });
});
