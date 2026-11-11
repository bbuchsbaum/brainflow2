import React, { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetCard, SidecarCard } from '@brainflow/api';
import { DatasetCardHost } from '../DatasetCardHost';
import {
  getDatasetCardService,
  resetDatasetCardServiceForTests,
} from '@/services/DatasetCardService';
import { setTransport } from '@/services/transport';
import { markerKey, useDatasetCardStore } from '@/stores/datasetCardStore';
import { sourcesDetail, sourcesLabel } from '../datasetCardFormat';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode } from '@/types/filesystem';

const studio = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/services/studio/SetStudioService', () => ({
  getSetStudioService: () => ({ openFolderOntologyInStudio: studio.open }),
}));
const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('@/utils/copyToClipboard', () => ({ copyToClipboard: clipboard.copy }));

const MOUNT = '/cache/mounts/trillium';
const ROOT = `${MOUNT}/pcmri`;
const GLM = `${ROOT}/derivatives/glm_recog`;

const remoteRoot: FileTreeNode = {
  id: MOUNT,
  name: 'trillium',
  path: MOUNT,
  type: 'directory',
  depth: 0,
  mountSource: {
    kind: 'remote',
    label: 'trillium',
    host: 'trillium.alliancecan.ca',
    user: 'brad',
    mountId: 'm1',
    remotePath: '/scratch/brad/dsets',
  },
};

function emptyCard(path: string): DatasetCard {
  return {
    phase: 'full',
    path,
    folderName: path.split('/').pop() ?? path,
    hasDescription: false,
    description: null,
    descriptionIssue: null,
    descriptionPath: null,
    descriptionRaw: null,
    descriptionRawTruncated: false,
    readme: null,
    contents: {
      subjectCount: 0,
      sessionCount: 0,
      tasks: [],
      spaces: [],
      imageCount: 0,
      hasGroupLevel: false,
      groupImageCount: 0,
      imageKinds: [],
      imageKindCount: 0,
      truncated: false,
      truncatedReason: null,
    },
    analyses: [],
    analysesPath: null,
    analysesTruncated: false,
    sourcePaths: [],
  };
}

function glmCard(): DatasetCard {
  return {
    ...emptyCard(GLM),
    hasDescription: true,
    description: {
      name: 'Recognition GLM, first and group level',
      bidsVersion: '1.8.0',
      datasetType: 'derivative',
      license: 'CC BY 4.0',
      authors: ['A. Author', 'B. Author'],
      acknowledgements: null,
      howToAcknowledge: null,
      funding: ['NSERC 123'],
      ethicsApprovals: [],
      referencesAndLinks: [],
      datasetDoi: '10.1234/abcd',
      hedVersion: [],
      description: null,
      generatedBy: [
        {
          name: 'fmrireg',
          version: '0.4.1',
          description: null,
          codeUrl: null,
          container: { type: 'docker', tag: null, uri: 'docker://bbuchsbaum/fmrireg:0.4.1' },
        },
      ],
      sourceDatasets: [{ url: '../fmriprep', doi: null, version: '23.2.1' }],
      otherFields: [
        { key: 'PipelineDescription', value: '{"Name":"x"}', truncated: false },
        { key: 'Extra', value: '"long…', truncated: true },
      ],
    },
    descriptionPath: `${GLM}/dataset_description.json`,
    descriptionRaw: '{"Name":"Recognition GLM, first and group level"}',
    readme: {
      fileName: 'README.md',
      path: `${GLM}/README.md`,
      text: '# Recognition phase model\n\nMaps are in template space.',
      truncated: false,
    },
    contents: {
      subjectCount: 35,
      sessionCount: 0,
      tasks: ['recog'],
      spaces: ['MNI152NLin2009cAsym'],
      imageCount: 74,
      hasGroupLevel: true,
      groupImageCount: 4,
      imageKinds: [
        { path: 'enc_rep/maps/same_item.nii.gz', count: 35, subjectFolders: 35 },
        { path: 'enc_rep/maps/diff_item.nii.gz', count: 35, subjectFolders: 35 },
      ],
      imageKindCount: 3,
      truncated: false,
      truncatedReason: null,
    },
    sourcePaths: [`${GLM}/dataset_description.json`, `${GLM}/README.md`],
  };
}

function collectionCard(): DatasetCard {
  return {
    ...emptyCard(ROOT),
    hasDescription: true,
    description: {
      name: 'PCMRI',
      bidsVersion: '1.8.0',
      datasetType: 'raw',
      license: 'CC0',
      authors: ['A. Author'],
      acknowledgements: null,
      howToAcknowledge: null,
      funding: [],
      ethicsApprovals: [],
      referencesAndLinks: [],
      datasetDoi: null,
      hedVersion: [],
      description: 'A study of recognition memory.',
      generatedBy: [],
      sourceDatasets: [],
      otherFields: [],
    },
    descriptionRaw: '{"Name":"PCMRI"}',
    contents: { ...emptyCard(ROOT).contents, subjectCount: 35, tasks: ['encoding', 'recog'] },
    analyses: [
      {
        path: `${ROOT}/derivatives/fmriprep`,
        folderName: 'fmriprep',
        title: 'Preprocessed data',
        generatedBy: { name: 'fMRIPrep', version: '23.2.1' },
        subjectCount: 35,
        subjectCountTruncated: false,
        hasGroupLevel: false,
        hasDescription: true,
        issue: null,
        date: null,
      },
      {
        path: GLM,
        folderName: 'glm_recog',
        title: 'Recognition GLM, first and group level',
        generatedBy: { name: 'fmrireg', version: '0.4.1' },
        subjectCount: 35,
        subjectCountTruncated: false,
        hasGroupLevel: true,
        hasDescription: true,
        issue: null,
        date: null,
      },
      {
        path: `${ROOT}/derivatives/rsa_item`,
        folderName: 'rsa_item',
        title: null,
        generatedBy: null,
        subjectCount: 32,
        subjectCountTruncated: false,
        hasGroupLevel: false,
        hasDescription: false,
        issue: null,
        date: null,
      },
    ],
    analysesPath: `${ROOT}/derivatives`,
    sourcePaths: [`${ROOT}/dataset_description.json`],
  };
}

function sidecarCard(): SidecarCard {
  const file = `${GLM}/sub-1006/maps/sub-1006_task-recog_stat-beta.nii.gz`;
  return {
    path: file,
    fileName: 'sub-1006_task-recog_stat-beta.nii.gz',
    header: {
      dim: [97, 115, 97],
      voxelSizes: [2, 2, 2],
      datatype: 'float32',
      trSeconds: null,
      nVolumes: 1,
      qformCode: 1,
      sformCode: 1,
    },
    headerIssue: null,
    datasetRoot: GLM,
    entityNamed: true,
    entries: [
      {
        key: 'ContrastName',
        value: '"same_item"',
        valueTruncated: false,
        sourceLevel: 'file',
        sourcePath: `${GLM}/sub-1006/maps/sub-1006_task-recog_stat-beta.json`,
        overriddenPaths: [`${GLM}/task-recog_stat-beta.json`],
      },
      {
        key: 'StatisticType',
        value: '"Beta estimate"',
        valueTruncated: false,
        sourceLevel: 'file',
        sourcePath: `${GLM}/sub-1006/maps/sub-1006_task-recog_stat-beta.json`,
        overriddenPaths: [],
      },
      {
        key: 'Sources',
        value: '"bids:fmriprep:sub-1006/func/sub-1006_bold.nii.gz"',
        valueTruncated: false,
        sourceLevel: 'directory',
        sourcePath: `${GLM}/sub-1006/maps/stat-beta.json`,
        overriddenPaths: [],
      },
      {
        key: 'SkullStripped',
        value: 'true',
        valueTruncated: false,
        sourceLevel: 'subject',
        sourcePath: `${GLM}/sub-1006/sub-1006_stat-beta.json`,
        overriddenPaths: [],
      },
      {
        key: 'RepetitionTime',
        value: '1.5',
        valueTruncated: false,
        sourceLevel: 'dataset',
        sourcePath: `${GLM}/task-recog_stat-beta.json`,
        overriddenPaths: [],
      },
      {
        key: 'SliceTiming',
        value: '[0,0.5,1]',
        valueTruncated: false,
        sourceLevel: 'session',
        sourcePath: `${GLM}/sub-1006/ses-1/x.json`,
        overriddenPaths: [],
      },
    ],
    sidecarPaths: ['a', 'b', 'c'],
    issues: [],
    truncated: false,
  };
}

function Harness() {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} data-testid="anchor">
        <div role="treeitem" tabIndex={0} data-fs-path={ROOT} aria-selected={false}>
          pcmri
        </div>
      </div>
      <DatasetCardHost anchorRef={anchor} />
    </>
  );
}

type Phase = DatasetCard['phase'];
const cards = new Map<string, DatasetCard | ((phase: Phase) => Promise<DatasetCard>)>();
let sidecar: SidecarCard | null = null;
const invoke = vi.fn(async (cmd: string, args?: unknown) => {
  const record = (args ?? {}) as { path?: string; phase?: Phase };
  if (cmd === 'get_dataset_card') {
    const answer = cards.get(record.path ?? '');
    if (!answer) throw { Io: { code: 8263, details: 'no such folder' } };
    return typeof answer === 'function' ? answer(record.phase ?? 'full') : answer;
  }
  if (cmd === 'get_sidecar_card') return sidecar;
  if (cmd === 'probe_dataset_markers') return [];
  return undefined;
});

async function open(path: string) {
  await act(async () => {
    getDatasetCardService().openDatasetCard({ rootPath: MOUNT, path });
  });
  return screen.findByTestId('dataset-card');
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  resetDatasetCardServiceForTests();
  cards.clear();
  sidecar = null;
  invoke.mockClear();
  studio.open.mockReset();
  clipboard.copy.mockReset();
  setTransport({ invoke } as never);
  useFileBrowserStore.setState({ entries: [remoteRoot] });
});

describe('dataset card', () => {
  it('shows the sections in order, with the remote origin as the path', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    expect(card).toHaveAttribute('role', 'dialog');
    expect(card).not.toHaveAttribute('aria-modal');
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        'brad@trillium.alliancecan.ca:/scratch/brad/dsets/pcmri/derivatives/glm_recog',
      ),
    ).toBeInTheDocument();
    for (const chip of ['Derivative', 'BIDS 1.8.0', 'CC BY 4.0']) {
      expect(within(card).getByText(chip)).toBeInTheDocument();
    }
    const sections = within(card)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(sections.slice(0, 4)).toEqual([
      'What is in the folder',
      'Generated by',
      'People',
      'Readme',
    ]);

    // Each number is said once, on one line of totals, with its unit.
    const totals = within(card).getByTestId('content-totals');
    expect(totals).toHaveTextContent(
      '35 subjects · 3 image kinds · 74 images · 4 group-level images',
    );
    // Spoken as text (an `aria-label` on a paragraph is not announced), and
    // the written line is hidden from a screen reader so it is not said twice.
    expect(within(totals).getByTestId('content-totals-spoken')).toHaveTextContent(
      /^35 subjects, 3 image kinds, 74 images, 4 group-level images$/,
    );
    expect(totals).not.toHaveAttribute('aria-label');
    for (const written of totals.querySelectorAll('[data-count]')) {
      expect(written).toHaveAttribute('aria-hidden', 'true');
    }
    expect(card.querySelector('[data-count="sessions"]')).toBeNull();
    // No tiles and no "Levels" row repeating them.
    expect(card.querySelector('li[data-count]')).toBeNull();
    expect(within(card).queryByText('Levels')).toBeNull();
    expect(within(card).queryByText('Subject, group')).toBeNull();
    expect(within(card).getByText('enc_rep/maps/same_item.nii.gz')).toBeInTheDocument();
    expect(within(card).getByText('and 1 more kind')).toBeInTheDocument();
    expect(within(card).getByText('Counted from the file listing.')).toBeInTheDocument();
    expect(within(card).getByText('docker://bbuchsbaum/fmrireg:0.4.1')).toBeInTheDocument();
    expect(within(card).getByText('../fmriprep · 23.2.1')).toBeInTheDocument();
    expect(within(card).getByText('A. Author, B. Author')).toBeInTheDocument();
    expect(within(card).getByText('10.1234/abcd')).toBeInTheDocument();
    expect(
      within(card).getByRole('heading', { name: 'Recognition phase model' }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText('Read from dataset_description.json and README.md'),
    ).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/\[Authors|\[Funding|\[DatasetDOI|\[License/);
  });

  it('keeps other fields collapsed until asked', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    const toggle = within(card).getByRole('button', { name: /Other fields/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('Other fields 2 fields');
    expect(within(toggle).getByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).queryByText('PipelineDescription')).toBeNull();
    fireEvent.click(toggle);
    expect(within(card).getByText('PipelineDescription')).toBeInTheDocument();
    expect(within(card).getByText('(cut short)')).toBeInTheDocument();
  });

  it('omits every section whose data is absent', async () => {
    cards.set(GLM, emptyCard(GLM));
    render(<Harness />);
    const card = await open(GLM);
    const sections = within(card)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(sections).toEqual(['What is in the folder']);
    expect(within(card).getByRole('heading', { name: 'glm_recog' })).toBeInTheDocument();
    expect(
      within(card).getByText('This folder has no dataset_description.json.'),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /raw JSON/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Other fields/ })).toBeNull();
    expect(within(card).queryByText('Levels')).toBeNull();
    expect(within(card).queryByText('Space')).toBeNull();
    expect(within(card).getByText('0 images')).toBeInTheDocument();
  });

  it('shows truncated counts as floors, with the reason', async () => {
    const card = glmCard();
    card.contents = {
      ...card.contents,
      truncated: true,
      truncatedReason: 'stopped after 20000 entries',
    };
    cards.set(GLM, card);
    render(<Harness />);
    const element = await open(GLM);
    expect(within(element).getByTestId('content-totals-spoken')).toHaveTextContent(
      'at least 35 subjects',
    );
    expect(element.querySelector('[data-count="subjects"]')?.textContent).toContain('35+');
    expect(element.querySelector('[data-count="images"]')?.textContent).toContain('74+');
    expect(within(element).getByTestId('contents-truncated')).toHaveTextContent(
      'every number is a lower bound: stopped after 20000 entries',
    );
  });

  it('notes a partly read description without hiding the rest', async () => {
    const card = glmCard();
    card.descriptionIssue = 'Authors is not a list';
    cards.set(GLM, card);
    render(<Harness />);
    const element = await open(GLM);
    expect(within(element).getByTestId('description-issue')).toHaveTextContent(
      'Authors is not a list',
    );
    expect(within(element).getByText('What is in the folder')).toBeInTheDocument();
  });

  it('toggles the raw JSON, copies it, and says when it is cut', async () => {
    const card = glmCard();
    card.descriptionRaw = '{"Name":"Recog"';
    card.descriptionRawTruncated = true;
    cards.set(GLM, card);
    render(<Harness />);
    const element = await open(GLM);
    fireEvent.click(within(element).getByRole('button', { name: 'Show raw JSON' }));
    const raw = within(element).getByRole('region', { name: 'Raw JSON' });
    expect(raw.querySelector('pre')?.textContent).toBe('{"Name":"Recog"');
    expect(
      within(raw).getByText('The file is longer than the part shown here.'),
    ).toBeInTheDocument();
    fireEvent.click(within(raw).getByRole('button', { name: 'Copy' }));
    expect(clipboard.copy).toHaveBeenCalledWith('{"Name":"Recog"', 'Description JSON');
    fireEvent.click(within(element).getByRole('button', { name: 'Hide raw JSON' }));
    expect(within(element).queryByRole('region', { name: 'Raw JSON' })).toBeNull();
  });

  it('opens the folder as a set through the folder-review entry point', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    fireEvent.click(within(card).getByRole('button', { name: 'Open as set' }));
    await waitFor(() => expect(studio.open).toHaveBeenCalledWith({ discoveryRoot: GLM }));
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('hides Open as set when the folder is under no mounted root', async () => {
    cards.set(GLM, glmCard());
    useDatasetCardStore.setState({
      card: {
        kind: 'dataset',
        rootPath: MOUNT,
        path: '/elsewhere/glm',
        originPath: '/elsewhere/glm',
        status: 'ready',
        dataset: { ...glmCard(), path: '/elsewhere/glm' },
        sidecar: null,
        error: null,
        countsError: null,
        backStack: [],
      },
    });
    render(<Harness />);
    const card = await screen.findByTestId('dataset-card');
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
  });
});

describe('collection card', () => {
  it('lists the analyses, then this folder’s own facts', async () => {
    cards.set(ROOT, collectionCard());
    render(<Harness />);
    const card = await open(ROOT);
    expect(within(card).getByText('A study of recognition memory.')).toBeInTheDocument();
    const table = within(card).getByRole('table', { name: 'Analyses in derivatives' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('fmriprep')).toBeInTheDocument();
    // One line: the count and the group level together, never "0 + group".
    const subjects = rows[1].querySelector('[data-subjects]') as HTMLElement;
    expect(within(subjects).getByText('35 + group')).toHaveAttribute('aria-hidden', 'true');
    expect(within(subjects).getByText('35 subjects and a group level')).toHaveClass('sr-only');
    // A child without a description: its folder name stands in for a title,
    // and the row's tooltip says what is missing.
    expect(within(rows[2]).getByText('rsa_item')).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute('title', 'rsa_item\nNo description file');
    expect(within(rows[2]).queryByText('Not declared')).toBeNull();
    expect(
      within(card.querySelector('header') as HTMLElement).getByText('35 subjects'),
    ).toBeInTheDocument();
    expect(within(card).getByText('This dataset')).toBeInTheDocument();
    expect(within(card).getByText('encoding, recog')).toBeInTheDocument();
    expect(within(card).getByText('CC0')).toBeInTheDocument();
    expect(within(card).queryByText('What is in the folder')).toBeNull();
    // Open as set belongs to an analysis's own card, not to the collection.
    expect(within(card).queryByRole('button', { name: /Open .* as set|Open as set/ })).toBeNull();
  });

  it('a row opens from anywhere on it, its title is its one button, and Open as set waits on the analysis card', async () => {
    cards.set(ROOT, collectionCard());
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(ROOT);
    const table = within(card).getByRole('table', { name: 'Analyses in derivatives' });
    const row = table.querySelector('[data-analysis="glm_recog"]') as HTMLElement;
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByRole('button')).toHaveAccessibleName(
      'Recognition GLM, first and group level',
    );
    expect(within(table).queryByRole('button', { name: /Details|as set/ })).toBeNull();
    await act(async () => {
      fireEvent.click(row);
    });
    expect(
      await within(card).findByRole('heading', { name: 'What is in the folder' }),
    ).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Open as set' }));
    await waitFor(() => expect(studio.open).toHaveBeenCalledWith({ discoveryRoot: GLM }));
  });

  it('a row opens that analysis in the same card, and back returns to the collection', async () => {
    cards.set(ROOT, collectionCard());
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(ROOT);
    const row = card.querySelector('[data-analysis="glm_recog"]') as HTMLElement;
    const opener = within(row).getByRole('button');
    await act(async () => {
      opener.focus();
      // Enter or Space on a button is a click.
      fireEvent.click(opener);
    });
    expect(
      await within(card).findByRole('heading', { name: 'What is in the folder' }),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      'get_dataset_card',
      expect.objectContaining({ path: GLM, rootPath: MOUNT }),
    );
    expect(within(card).queryByRole('table', { name: /Analyses/ })).toBeNull();
    const calls = invoke.mock.calls.length;
    fireEvent.click(within(card).getByRole('button', { name: 'Back to PCMRI' }));
    expect(
      within(card).getByRole('table', { name: 'Analyses in derivatives' }),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Back to PCMRI' })).toBeNull();
    expect(invoke.mock.calls.length).toBe(calls);
  });
});

describe('progressive loading', () => {
  /** Answer the descriptions at once; hold the count until `finish` is called. */
  function twoPhases(path: string, whole: DatasetCard, patch: Partial<DatasetCard> = {}) {
    let finish!: (card: DatasetCard) => void;
    let fail!: (error: unknown) => void;
    const outline: DatasetCard = {
      ...whole,
      phase: 'descriptions',
      contents: emptyCard(path).contents,
      analyses: whole.analyses
        .filter((analysis) => analysis.hasDescription)
        .map((analysis) => ({ ...analysis, subjectCount: 0, hasGroupLevel: false })),
      ...patch,
    };
    cards.set(path, (phase) =>
      phase === 'descriptions'
        ? Promise.resolve(outline)
        : new Promise<DatasetCard>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
    );
    return { finish: () => finish(whole), fail: (error: unknown) => fail(error) };
  }

  it('an analysis card is usable from its descriptions, and its counts fill in afterwards', async () => {
    const count = twoPhases(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    // Title, generator, people and README are here before anything is counted.
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
    expect(within(card).getByText('docker://bbuchsbaum/fmrireg:0.4.1')).toBeInTheDocument();
    expect(within(card).getByText('A. Author, B. Author')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Recognition phase model' })).toBeTruthy();
    // Nothing says yet that this folder holds no analyses (no marker, and a
    // remote one would not have looked): the offer waits for the count
    // rather than appear and then go away.
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
    // The counted area waits quietly: one muted line, no spinner, no zeros.
    const pending = within(card).getByTestId('counts-pending');
    expect(pending).toHaveTextContent('Counting subjects and images…');
    expect(pending).toHaveAttribute('role', 'status');
    expect(card.querySelector('[class*="animate-spin"]')).toBeNull();
    expect(within(card).queryByTestId('content-totals')).toBeNull();
    expect(within(card).queryByText('0 images')).toBeNull();
    expect(within(card).queryByRole('table', { name: 'Image kinds' })).toBeNull();
    expect(within(card).queryByText('Reading the folder…')).toBeNull();

    await act(async () => count.finish());
    expect(within(card).queryByTestId('counts-pending')).toBeNull();
    expect(within(card).getByTestId('content-totals')).toHaveTextContent('35 subjects');
    expect(within(card).getByRole('button', { name: 'Open as set' })).toBeInTheDocument();
    // The same title node: the card was filled in, not rebuilt.
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
  });

  it('a collection lists its analyses at once; subject counts and its own facts follow', async () => {
    const count = twoPhases(ROOT, collectionCard());
    render(<Harness />);
    const card = await open(ROOT);
    expect(within(card).getByText('A study of recognition memory.')).toBeInTheDocument();
    const table = within(card).getByRole('table', { name: 'Analyses in derivatives' });
    // Only the described analyses are known yet, and the count says so.
    expect(table.querySelectorAll('[data-analysis]')).toHaveLength(2);
    expect(within(card).getByText('2+')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).getByText('at least 2 analyses')).toHaveClass('sr-only');
    for (const cell of table.querySelectorAll('[data-subjects]')) {
      expect(cell).toHaveAttribute('data-subjects', 'pending');
    }
    expect(within(card).getByTestId('counts-pending')).toHaveTextContent('Counting this folder…');
    // No subject chip and no tasks before the folder is counted.
    expect(within(card).queryByText('35 subjects')).toBeNull();
    expect(within(card).queryByText('encoding, recog')).toBeNull();
    expect(within(card).getByText('CC0')).toBeInTheDocument();

    await act(async () => count.finish());
    expect(table.querySelectorAll('[data-analysis]')).toHaveLength(3);
    expect(within(card).getByText('3 analyses')).toHaveClass('sr-only');
    expect(within(card).queryByText('2+')).toBeNull();
    expect(table.querySelector('[data-analysis="glm_recog"] [data-subjects]')).toHaveTextContent(
      '35 + group',
    );
    expect(within(card).getByText('encoding, recog')).toBeInTheDocument();
    expect(within(card).queryByTestId('counts-pending')).toBeNull();
  });

  it('keeps the descriptions when the count fails, and counts again on request', async () => {
    const count = twoPhases(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    await act(async () => count.fail({ Io: { code: 8263, details: 'x' } }));
    const error = within(card).getByTestId('counts-error');
    expect(error).toHaveTextContent(
      'Subjects and images could not be counted: This could not be read.',
    );
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
    expect(within(card).queryByTestId('content-totals')).toBeNull();
    cards.set(GLM, glmCard());
    await act(async () => {
      fireEvent.click(within(error).getByRole('button', { name: 'Count again' }));
    });
    expect(await within(card).findByTestId('content-totals')).toHaveTextContent('74 images');
  });

  it('offers Reconnect when the count failed on a dropped connection, and counts again when the mount is back', async () => {
    const { markRemoteMountActive, resetRemoteConnectionStore, useRemoteConnectionStore } =
      await import('@/stores/remoteConnectionStore');
    resetRemoteConnectionStore();
    const count = twoPhases(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    await act(async () =>
      count.fail({ Io: { code: 8266, details: 'SSH error: SSH session disconnected' } }),
    );
    const error = within(card).getByTestId('counts-error');
    const labels = within(error)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Reconnect', 'Count again']);
    // The descriptions stay; the Files header can say the mount is down.
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
    expect(useRemoteConnectionStore.getState().down).toEqual({ [MOUNT]: true });

    cards.set(GLM, glmCard());
    await act(async () => {
      markRemoteMountActive(MOUNT);
    });
    expect(await within(card).findByTestId('content-totals')).toHaveTextContent('74 images');
    expect(within(card).queryByTestId('dataset-card-counts-reconnect')).toBeNull();
    resetRemoteConnectionStore();
  });

  it('a count that failed another way offers no Reconnect and is not repeated by a reconnect', async () => {
    const { markRemoteMountActive, resetRemoteConnectionStore } = await import(
      '@/stores/remoteConnectionStore'
    );
    resetRemoteConnectionStore();
    const count = twoPhases(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    await act(async () => count.fail({ Io: { code: 8263, details: 'x' } }));
    const error = within(card).getByTestId('counts-error');
    expect(within(error).queryByTestId('dataset-card-counts-reconnect')).toBeNull();
    const reads = invoke.mock.calls.filter(([cmd]) => cmd === 'get_dataset_card').length;
    await act(async () => {
      markRemoteMountActive(MOUNT);
    });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'get_dataset_card')).toHaveLength(reads);
  });

  it('a row opened before the collection is counted works, and closing stops the count', async () => {
    twoPhases(ROOT, collectionCard());
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(ROOT);
    await act(async () => {
      fireEvent.click(card.querySelector('[data-analysis="glm_recog"]') as HTMLElement);
    });
    expect(await within(card).findByTestId('content-totals')).toBeInTheDocument();
    // The collection's walk was cancelled by its ticket when the card moved on.
    const cancelled = invoke.mock.calls.filter(([cmd]) => cmd === 'cancel_population_sample');
    expect(cancelled).toHaveLength(1);
    const walk = invoke.mock.calls.find(
      ([cmd, args]) =>
        cmd === 'get_dataset_card' && (args as { phase: string; path: string }).phase === 'full',
    );
    expect((cancelled[0][1] as { ticket: unknown }).ticket).toEqual(
      (walk?.[1] as { ticket: unknown }).ticket,
    );
  });
});

describe('what the analysis card counts', () => {
  it('lists image kinds in one small table, complete or visibly not', async () => {
    const glm = glmCard();
    glm.contents.imageKinds = [
      { path: 'enc_rep/maps/same_item.nii.gz', count: 35, subjectFolders: 35 },
      { path: 'enc_rep/maps/diff_item.nii.gz', count: 33, subjectFolders: 35 },
    ];
    cards.set(GLM, glm);
    render(<Harness />);
    const card = await open(GLM);
    const table = within(card).getByRole('table', { name: 'Image kinds' });
    const [complete, partial] = [...table.querySelectorAll<HTMLElement>('[data-kind]')];
    expect(complete).toHaveAttribute('data-complete', 'true');
    expect(within(complete).getByText('35 of 35')).toHaveAttribute(
      'aria-label',
      '35 images, one for each of 35 subjects',
    );
    expect(partial).toHaveAttribute('data-complete', 'false');
    const short = within(partial).getByLabelText('33 images for 35 subjects, 2 missing');
    expect(short).toHaveTextContent('33 of 35 · 2 missing');
    // Different in form, not in hue.
    expect(short.className).toContain('font-semibold');
    expect(within(complete).getByText('35 of 35').className).not.toContain('font-semibold');
    expect(short.className).toContain('tabular-nums');
    // The subject count is said once: in the totals, not in a tile or a chip.
    expect(card.querySelectorAll('[data-count="subjects"]')).toHaveLength(1);
    expect(within(card).queryByText('Levels')).toBeNull();
  });
});

describe('the collection header', () => {
  it('shows no subject chip on a folder that only holds analyses', async () => {
    const collection = collectionCard();
    // `pcmri` on the mount: no description of its own, a stray sub-* beside derivatives/.
    collection.hasDescription = false;
    collection.description = null;
    collection.contents = {
      ...collection.contents,
      subjectCount: 1,
      truncated: true,
      truncatedReason: 'x',
    };
    cards.set(ROOT, collection);
    render(<Harness />);
    const card = await open(ROOT);
    expect(within(card).getByRole('table', { name: 'Analyses in derivatives' })).toBeTruthy();
    expect(within(card).queryByText(/1\+ subject/)).toBeNull();
    expect(within(card).queryByLabelText('at least 1 subject')).toBeNull();
  });

  it('keeps it on a collection that is itself a described dataset', async () => {
    cards.set(ROOT, collectionCard());
    render(<Harness />);
    const card = await open(ROOT);
    // The chip, in the header; the rows' own cells say "35".
    expect(
      within(card.querySelector('header') as HTMLElement).getByText('35 subjects'),
    ).toBeInTheDocument();
  });
});

describe('sidecar card', () => {
  it('unquotes plain strings, keeps mono for numbers and paths, and tags each level in text', async () => {
    sidecar = sidecarCard();
    render(<Harness />);
    await act(async () => {
      getDatasetCardService().openSidecarCard({ rootPath: MOUNT, path: sidecar!.path });
    });
    const card = await screen.findByTestId('dataset-card');
    expect(
      within(card).getByRole('heading', { name: 'sub-1006_task-recog_stat-beta.nii.gz' }),
    ).toHaveClass('font-mono');
    expect(within(card).getByText('glm_recog/sub-1006/maps')).toBeInTheDocument();
    expect(within(card).getByText('97 × 115 × 97 · 2.00 mm')).toBeInTheDocument();
    expect(within(card).getByText('float32')).toBeInTheDocument();
    expect(within(card).getByText('Read from the image header.')).toBeInTheDocument();
    expect(within(card).getByText('merged from 3 files')).toBeInTheDocument();

    const value = (key: string) =>
      card.querySelector(`[data-sidecar-key="${key}"] [data-sidecar-value]`) as HTMLElement;
    expect(value('ContrastName')).toHaveTextContent(/^same_item$/);
    expect(value('ContrastName')).not.toHaveClass('font-mono');
    expect(value('StatisticType')).toHaveTextContent(/^Beta estimate$/);
    expect(value('Sources')).toHaveTextContent(
      /^bids:fmriprep:sub-1006\/func\/sub-1006_bold\.nii\.gz$/,
    );
    expect(value('Sources')).toHaveClass('font-mono');
    expect(value('SkullStripped')).toHaveTextContent(/^true$/);
    expect(value('RepetitionTime')).toHaveTextContent(/^1\.5$/);
    expect(value('RepetitionTime')).toHaveClass('font-mono');
    expect(value('SliceTiming')).toHaveTextContent('[0,0.5,1]');

    const tag = (key: string) =>
      card.querySelector(`[data-sidecar-key="${key}"] [data-level]`) as HTMLElement;
    expect(tag('ContrastName')).toHaveTextContent('This file');
    expect(tag('ContrastName')).toHaveClass('border-solid');
    expect(tag('ContrastName').title).toBe(
      'Set in sub-1006/maps/sub-1006_task-recog_stat-beta.json\nReplaces the value in task-recog_stat-beta.json',
    );
    expect(tag('Sources')).toHaveTextContent('Folder');
    expect(tag('SliceTiming')).toHaveTextContent('Session');
    expect(tag('SkullStripped')).toHaveTextContent('Subject');
    expect(tag('SkullStripped')).toHaveClass('border-dashed');
    expect(tag('RepetitionTime')).toHaveTextContent('Dataset');
    expect(tag('RepetitionTime')).toHaveClass('border-dotted');
    // The three forms differ by line, not by hue.
    const colours = new Set(
      ['ContrastName', 'SkullStripped', 'RepetitionTime'].map(
        (key) => tag(key).className.match(/border-bf-[\w-]+/)?.[0],
      ),
    );
    expect(colours.size).toBe(1);

    fireEvent.click(within(card).getByRole('button', { name: 'Show raw JSON' }));
    const raw = within(card).getByRole('region', { name: 'Raw JSON' }).querySelector('pre');
    expect(JSON.parse(raw?.textContent ?? '')).toMatchObject({
      ContrastName: 'same_item',
      SkullStripped: true,
      RepetitionTime: 1.5,
      SliceTiming: [0, 0.5, 1],
    });
  });

  it('says so when no sidecar applies and the name is not BIDS', async () => {
    sidecar = { ...sidecarCard(), entries: [], sidecarPaths: [], entityNamed: false, header: null };
    sidecar.headerIssue = 'Not a NIfTI file.';
    render(<Harness />);
    await act(async () => {
      getDatasetCardService().openSidecarCard({ rootPath: MOUNT, path: sidecar!.path });
    });
    const card = await screen.findByTestId('dataset-card');
    expect(within(card).getByText('No sidecar metadata applies to this file.')).toBeInTheDocument();
    expect(within(card).getByText('Not a NIfTI file.')).toBeInTheDocument();
    expect(
      within(card).getByText(/only the sidecar with the same name applies/),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/merged from/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Show raw JSON' })).toBeNull();
  });
});

describe('the pinned surface', () => {
  it('shows a loading state, then an error with Retry that reads again', async () => {
    render(<Harness />);
    const card = await open(GLM); // no such card: 8263
    expect(
      await within(card).findByText('This could not be read. It may have moved or been deleted.'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'glm_recog' })).toBeInTheDocument();
    cards.set(GLM, glmCard());
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    });
    expect(await within(card).findByText('What is in the folder')).toBeInTheDocument();
  });

  it('says it is reading while the load is pending', async () => {
    let finish!: (card: DatasetCard) => void;
    cards.set(GLM, () => new Promise<DatasetCard>((resolve) => (finish = resolve)));
    render(<Harness />);
    const card = await open(GLM);
    expect(within(card).getByRole('status')).toHaveTextContent('Reading the folder…');
    await act(async () => finish(glmCard()));
    expect(within(card).queryByRole('status')).toBeNull();
  });

  it('stays open on an outside click, closes on Escape, and returns focus to its row', async () => {
    cards.set(ROOT, collectionCard());
    render(<Harness />);
    const row = screen.getByRole('treeitem');
    row.focus();
    const card = await open(ROOT);
    await waitFor(() => expect(card).toHaveFocus());
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByTestId('dataset-card')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dataset-card')).toBeNull());
    expect(useDatasetCardStore.getState().card).toBeNull();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('closes from its close button, and another folder swaps the content in place', async () => {
    cards.set(ROOT, collectionCard());
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(ROOT);
    await open(GLM);
    expect(screen.getAllByTestId('dataset-card')).toHaveLength(1);
    expect(
      within(card).getByRole('heading', { name: 'Recognition GLM, first and group level' }),
    ).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('dataset-card')).toBeNull());
  });

  it('closes when its browse root is unmounted', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    await open(GLM);
    act(() => useFileBrowserStore.setState({ entries: [] }));
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());
  });
});

/** The panel the card belongs to, with the places focus can be when Escape is pressed. */
function PanelHarness() {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div data-testid="layout-tab">
        <div ref={anchor} data-testid="anchor">
          <div role="treeitem" tabIndex={0} data-fs-path={ROOT} aria-selected={false}>
            pcmri
          </div>
          <input aria-label="Filter files" />
          <div role="menu" tabIndex={-1} data-testid="panel-menu" />
        </div>
      </div>
      <button type="button">Elsewhere</button>
      <DatasetCardHost anchorRef={anchor} />
    </>
  );
}

function pressEscape() {
  // As the browser sends it: to the focused element, bubbling to the document.
  return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

describe('the pinned surface: keys, elevation and lifetime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is raised with the panel shadow token, under the app’s menus and dialogs', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    const classes = card.className.split(/\s+/);
    expect(classes).toContain('shadow-bf-panel');
    expect(classes).toContain('rounded-bf-md');
    // `shadow-[var(--token)]` compiles to a shadow colour, not a box-shadow.
    expect(card.className).not.toMatch(/shadow-\[var\(/);
    expect(classes).not.toContain('shadow-md');
    // The app context menu is z-50 and earlier in the document.
    expect(classes).toContain('z-40');
    expect(card.className).toContain('--radix-popover-content-available-height');
    // Header and footer stay; the body is what scrolls.
    const body = card.querySelector('[data-card-body]') as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    expect(card.querySelector('header')?.className).toContain('shrink-0');
    expect(card.querySelector('footer')?.className).toContain('shrink-0');
  });

  it('leaves Escape alone when focus is elsewhere in the app', async () => {
    cards.set(GLM, glmCard());
    render(<PanelHarness />);
    await open(GLM);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    pressEscape();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
    // Focus nowhere in particular is not the card's either.
    (document.activeElement as HTMLElement).blur();
    pressEscape();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
    expect(screen.getByTestId('dataset-card')).toBeInTheDocument();
  });

  it('leaves Escape to a field or a menu of the browser panel', async () => {
    cards.set(GLM, glmCard());
    render(<PanelHarness />);
    await open(GLM);
    screen.getByRole('textbox', { name: 'Filter files' }).focus();
    pressEscape();
    screen.getByTestId('panel-menu').focus();
    pressEscape();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
  });

  it('closes on Escape from a row of its browser panel, and from a control inside the card', async () => {
    cards.set(GLM, glmCard());
    render(<PanelHarness />);
    const card = await open(GLM);
    screen.getByRole('treeitem').focus();
    pressEscape();
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());

    const again = await open(GLM);
    within(again).getByRole('button', { name: 'Show raw JSON' }).focus();
    pressEscape();
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());
    expect(card).not.toBeInTheDocument();
  });

  it('closes on Space pressed on the card, but not on one of its controls', async () => {
    cards.set(GLM, glmCard());
    render(<Harness />);
    const card = await open(GLM);
    await waitFor(() => expect(card).toHaveFocus());
    const toggle = within(card).getByRole('button', { name: 'Show raw JSON' });
    expect(fireEvent.keyDown(toggle, { key: ' ', code: 'Space' })).toBe(true);
    expect(useDatasetCardStore.getState().card).not.toBeNull();
    // Space with a modifier is not the toggle.
    fireEvent.keyDown(card, { key: ' ', code: 'Space', metaKey: true });
    expect(useDatasetCardStore.getState().card).not.toBeNull();

    expect(fireEvent.keyDown(document.activeElement as Element, { key: ' ', code: 'Space' })).toBe(
      false,
    );
    expect(useDatasetCardStore.getState().card).toBeNull();
    // The scrolling body is not a control: Space there closes too.
    const reopened = await open(GLM);
    fireEvent.keyDown(reopened.querySelector('[data-card-body]') as HTMLElement, { key: ' ' });
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('closes when its panel is hidden behind another layout tab', async () => {
    const observers: Array<{ callback: () => void; target: Element | null }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly entry: { callback: () => void; target: Element | null };
        constructor(callback: () => void) {
          this.entry = { callback, target: null };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        disconnect() {
          this.entry.target = null;
        }
        unobserve() {}
      },
    );
    cards.set(GLM, glmCard());
    render(<PanelHarness />);
    await open(GLM);
    const anchor = screen.getByTestId('anchor');
    const fire = () =>
      act(() => {
        for (const observer of observers) if (observer.target === anchor) observer.callback();
      });
    // A resize of the visible panel is not a reason to close.
    fire();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
    // GoldenLayout hides an inactive tab's container with `display: none`.
    screen.getByTestId('layout-tab').style.display = 'none';
    fire();
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('keeps its content and width while it animates out', async () => {
    cards.set(ROOT, collectionCard());
    render(<Harness />);
    const card = await open(ROOT);
    expect(card.className).toContain('w-[min(620px');
    // Give the surface an exit animation, as the stylesheet does in the app.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      if (element !== card) return style;
      return new Proxy(style, {
        get: (target, key) =>
          key === 'animationName'
            ? card.getAttribute('data-state') === 'closed'
              ? 'exit'
              : 'enter'
            : Reflect.get(target, key),
      });
    });
    act(() => getDatasetCardService().close());
    expect(useDatasetCardStore.getState().card).toBeNull();
    const closing = screen.getByTestId('dataset-card');
    expect(closing).toHaveAttribute('data-state', 'closed');
    expect(within(closing).getByRole('heading', { name: 'PCMRI' })).toBeInTheDocument();
    expect(within(closing).getByRole('table')).toBeInTheDocument();
    expect(closing.className).toContain('w-[min(620px');
    expect(closing).toHaveAttribute('data-card-kind', 'dataset');
    // jsdom has no AnimationEvent: say which animation ended by hand.
    const ended = Object.assign(new Event('animationend', { bubbles: true }), {
      animationName: 'exit',
    });
    act(() => {
      closing.dispatchEvent(ended);
    });
    await waitFor(() => expect(screen.queryByTestId('dataset-card')).toBeNull());
  });

  it('closes the card and cancels its load when the panel goes away', async () => {
    cards.set(GLM, () => new Promise(() => {}));
    const { unmount } = render(<Harness />);
    await open(GLM);
    const ticket = (
      invoke.mock.calls.find(([cmd]) => cmd === 'get_dataset_card')?.[1] as { ticket: unknown }
    ).ticket;
    unmount();
    expect(useDatasetCardStore.getState().card).toBeNull();
    expect(invoke).toHaveBeenCalledWith('cancel_population_sample', { ticket });
  });

  it('forgets the markers of a root that was unmounted, and only those', async () => {
    const other: FileTreeNode = { ...remoteRoot, id: '/data/local', path: '/data/local' };
    useFileBrowserStore.setState({ entries: [remoteRoot, other] });
    const entry = (path: string) => ({
      marker: {
        path,
        hasDescription: true,
        analysisCount: null,
        analysisCountTruncated: false,
        summary: null,
        issue: null,
      },
      fetchedAtMs: Date.now(),
    });
    useDatasetCardStore.setState({
      markers: {
        [markerKey(MOUNT, GLM)]: entry(GLM),
        [markerKey('/data/local', '/data/local/a')]: entry('/data/local/a'),
      },
    });
    render(<Harness />);
    act(() => useFileBrowserStore.setState({ entries: [other] }));
    expect(Object.keys(useDatasetCardStore.getState().markers)).toEqual([
      markerKey('/data/local', '/data/local/a'),
    ]);
  });
});

describe('where a card was read from', () => {
  it('counts a file name read from several folders instead of repeating it', async () => {
    const collection = collectionCard();
    collection.readme = {
      fileName: 'README.md',
      path: `${ROOT}/README.md`,
      text: 'About',
      truncated: false,
    };
    collection.sourcePaths = [
      `${ROOT}/README.md`,
      `${ROOT}/dataset_description.json`,
      `${ROOT}/derivatives/fmriprep/dataset_description.json`,
      `${GLM}/dataset_description.json`,
    ];
    cards.set(ROOT, collection);
    render(<Harness />);
    const card = await open(ROOT);
    const note = within(card).getByText('Read from README.md and 3 dataset_description.json files');
    expect(note).toHaveAttribute(
      'title',
      [
        'README.md',
        'dataset_description.json',
        'derivatives/fmriprep/dataset_description.json',
        'derivatives/glm_recog/dataset_description.json',
      ].join('\n'),
    );
  });

  it('names each file once, in the order read', () => {
    expect(sourcesLabel([])).toBe('');
    expect(sourcesLabel(['/a/dataset_description.json'])).toBe('dataset_description.json');
    expect(sourcesLabel(['/a/dataset_description.json', '/a/README.md'])).toBe(
      'dataset_description.json and README.md',
    );
    expect(
      sourcesLabel(['/a/x/d.json', '/a/README', '/a/y/d.json', '/a/CHANGES', '/a/z/README']),
    ).toBe('2 d.json files, 2 README files and CHANGES');
    expect(sourcesDetail('/a', ['/a/x/d.json', '/elsewhere/d.json'])).toBe(
      'x/d.json\n/elsewhere/d.json',
    );
  });
});

// ── review fixes, 2026-11-10 ────────────────────────────────────────────────

function setMarker(path: string, analysisCount: number | null) {
  useDatasetCardStore.setState({
    markers: {
      ...useDatasetCardStore.getState().markers,
      [markerKey(MOUNT, path)]: {
        marker: {
          path,
          hasDescription: true,
          analysisCount,
          analysisCountTruncated: false,
          summary: null,
          issue: null,
        },
        fetchedAtMs: Date.now(),
      },
    },
  });
}

/** Answers held until the test releases them, per phase. */
function held(path: string) {
  const waiting = new Map<Phase, (card: DatasetCard) => void>();
  cards.set(
    path,
    (phase) => new Promise<DatasetCard>((resolve) => waiting.set(phase, resolve)),
  );
  return (phase: Phase, card: DatasetCard) => act(async () => waiting.get(phase)?.(card));
}

function manyAnalyses(count: number): DatasetCard {
  const collection = collectionCard();
  collection.analyses = Array.from({ length: count }, (_, index) => ({
    ...collection.analyses[0],
    path: `${ROOT}/derivatives/model_${index + 1}`,
    folderName: `model_${index + 1}`,
    title: `Model ${index + 1}`,
  }));
  return collection;
}

describe('focus stays with the card when what it shows is replaced', () => {
  it('keeps focus in the card when a row is opened, and Escape still closes it', async () => {
    cards.set(ROOT, collectionCard());
    const release = held(GLM);
    render(<PanelHarness />);
    const card = await open(ROOT);
    const opener = within(
      card.querySelector('[data-analysis="glm_recog"]') as HTMLElement,
    ).getByRole('button');
    opener.focus();
    expect(opener).toHaveFocus();
    await act(async () => {
      fireEvent.click(opener);
    });
    // The row is gone with the body it was in; the card took its focus.
    expect(within(card).getByRole('status')).toHaveTextContent('Reading the folder…');
    expect(opener).not.toBeInTheDocument();
    expect(card).toHaveFocus();
    // And again when the answer replaces the loading body.
    await release('descriptions', glmCard());
    expect(card.contains(document.activeElement)).toBe(true);

    // "Back" is replaced by the collection it leads to.
    const back = within(card).getByRole('button', { name: 'Back to PCMRI' });
    back.focus();
    await act(async () => {
      fireEvent.click(back);
    });
    expect(back).not.toBeInTheDocument();
    expect(card).toHaveFocus();
    pressEscape();
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());
  });

  it('treats focus left on the body as the card’s when the card was last focused', async () => {
    cards.set(GLM, glmCard());
    render(<PanelHarness />);
    const card = await open(GLM);
    await waitFor(() => expect(card).toHaveFocus());
    // As a browser leaves it when the focused control is removed.
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    pressEscape();
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());
  });

  it('does not take focus, or Escape, once the user has gone elsewhere', async () => {
    cards.set(ROOT, collectionCard());
    const release = held(GLM);
    render(<PanelHarness />);
    const card = await open(ROOT);
    await waitFor(() => expect(card).toHaveFocus());
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    await act(async () => {
      getDatasetCardService().showAnalysis(GLM);
    });
    await release('descriptions', glmCard());
    expect(elsewhere).toHaveFocus();

    // A press outside the card ends its claim on a body-focused Escape too.
    // Back in the card (it is already open, so it does not take focus itself).
    act(() => card.focus());
    expect(card).toHaveFocus();
    fireEvent.pointerDown(elsewhere);
    (document.activeElement as HTMLElement).blur();
    pressEscape();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
  });

  it('keeps focus in the card when "Count again" replaces its own notice', async () => {
    let fail!: (error: unknown) => void;
    let finish!: (card: DatasetCard) => void;
    const outline: DatasetCard = {
      ...glmCard(),
      phase: 'descriptions',
      contents: emptyCard(GLM).contents,
    };
    cards.set(GLM, (phase) =>
      phase === 'descriptions'
        ? Promise.resolve(outline)
        : new Promise<DatasetCard>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
    );
    render(<Harness />);
    const card = await open(GLM);
    // State of the view that a rebuilt card would lose.
    fireEvent.click(within(card).getByRole('button', { name: 'Show raw JSON' }));
    const raw = within(card).getByRole('region', { name: 'Raw JSON' });
    const title = within(card).getByRole('heading', {
      name: 'Recognition GLM, first and group level',
    });
    await act(async () => fail({ Io: { code: 8263, details: 'x' } }));
    const again = within(card).getByRole('button', { name: 'Count again' });
    again.focus();
    const asked = () =>
      invoke.mock.calls
        .filter(([cmd]) => cmd === 'get_dataset_card')
        .map(([, args]) => (args as { phase: Phase }).phase);
    expect(asked()).toEqual(['descriptions', 'full']);
    await act(async () => {
      fireEvent.click(again);
    });
    // Only the count is read again, and nothing shown was rebuilt on the way.
    expect(asked()).toEqual(['descriptions', 'full', 'full']);
    expect(within(card).queryByText('Reading the folder…')).toBeNull();
    expect(within(card).getByTestId('counts-pending')).toBeInTheDocument();
    expect(within(card).getByRole('region', { name: 'Raw JSON' })).toBe(raw);
    expect(title).toBeInTheDocument();
    expect(again).not.toBeInTheDocument();
    expect(card).toHaveFocus();
    await act(async () => finish(glmCard()));
    expect(within(card).getByTestId('content-totals')).toHaveTextContent('74 images');
    expect(within(card).getByRole('region', { name: 'Raw JSON' })).toBe(raw);
  });
});

describe('Escape in the analyses filter', () => {
  it('empties the filter first, and closes the card only when it is empty', async () => {
    cards.set(ROOT, manyAnalyses(12));
    render(<PanelHarness />);
    const card = await open(ROOT);
    const filter = within(card).getByRole('searchbox') as HTMLInputElement;
    filter.focus();
    fireEvent.change(filter, { target: { value: 'model 12' } });
    expect(card.querySelectorAll('[data-analysis]')).toHaveLength(1);
    pressEscape();
    expect(useDatasetCardStore.getState().card).not.toBeNull();
    expect(filter.value).toBe('');
    expect(card.querySelectorAll('[data-analysis]')).toHaveLength(12);
    expect(filter).toHaveFocus();
    pressEscape();
    await waitFor(() => expect(useDatasetCardStore.getState().card).toBeNull());
  });
});

describe('a collection known from its marker', () => {
  it('has its width and layout from the first paint, and never offers Open as set', async () => {
    setMarker(ROOT, 3);
    const release = held(ROOT);
    render(<Harness />);
    const card = await open(ROOT);
    // Still loading: already as wide as it will be.
    expect(within(card).getByRole('status')).toHaveTextContent('Reading the folder…');
    expect(card.className).toContain('w-[min(620px');

    // None of its analyses has a description: the outline lists none yet.
    const whole = collectionCard();
    whole.analyses = whole.analyses.map((entry) => ({
      ...entry,
      title: null,
      generatedBy: null,
      hasDescription: false,
    }));
    await release('descriptions', {
      ...whole,
      phase: 'descriptions',
      contents: emptyCard(ROOT).contents,
      analyses: [],
      analysesPath: null,
    });
    expect(card.className).toContain('w-[min(620px');
    const table = within(card).getByRole('table', { name: /^Analyses in/ });
    expect(within(table).getByText('Looking for analyses…')).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'What is in the folder' })).toBeNull();
    expect(within(card).getByRole('heading', { name: 'This dataset' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();

    await release('full', whole);
    expect(card.className).toContain('w-[min(620px');
    expect(card.querySelectorAll('[data-analysis]')).toHaveLength(3);
    expect(within(card).queryByText('Looking for analyses…')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
  });

  it('without a marker, a folder whose analyses appear only when counted never showed Open as set', async () => {
    const release = held(ROOT);
    render(<Harness />);
    const card = await open(ROOT);
    const whole = collectionCard();
    await release('descriptions', {
      ...whole,
      phase: 'descriptions',
      contents: emptyCard(ROOT).contents,
      analyses: [],
      analysesPath: null,
    });
    // Described, on a remote mount, not counted: it may yet hold analyses.
    expect(within(card).getByRole('heading', { name: 'PCMRI' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
    await release('full', whole);
    expect(card.querySelectorAll('[data-analysis]')).toHaveLength(3);
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
  });

  it('offers Open as set from the descriptions when a local marker found no analyses', async () => {
    useFileBrowserStore.setState({
      entries: [{ ...remoteRoot, mountSource: { kind: 'local' } }],
    });
    setMarker(GLM, null);
    const release = held(GLM);
    render(<Harness />);
    const card = await open(GLM);
    expect(card.className).toContain('w-[min(480px');
    await release('descriptions', {
      ...glmCard(),
      phase: 'descriptions',
      contents: emptyCard(GLM).contents,
    });
    expect(within(card).getByTestId('counts-pending')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Open as set' })).toBeInTheDocument();
    await release('full', glmCard());
    expect(within(card).getByRole('button', { name: 'Open as set' })).toBeInTheDocument();
    expect(card.className).toContain('w-[min(480px');
  });

  it('a remote marker that did not look decides nothing', async () => {
    setMarker(GLM, null);
    const release = held(GLM);
    render(<Harness />);
    const card = await open(GLM);
    await release('descriptions', {
      ...glmCard(),
      phase: 'descriptions',
      contents: emptyCard(GLM).contents,
    });
    expect(within(card).queryByRole('button', { name: 'Open as set' })).toBeNull();
    await release('full', glmCard());
    expect(within(card).getByRole('button', { name: 'Open as set' })).toBeInTheDocument();
  });
});

describe('a card on a dropped remote connection', () => {
  it('offers Reconnect, and reads the card again when the mount is back', async () => {
    const { markRemoteMountActive, resetRemoteConnectionStore, useRemoteConnectionStore } =
      await import('@/stores/remoteConnectionStore');
    resetRemoteConnectionStore();
    cards.set(GLM, () =>
      Promise.reject({ Io: { code: 8243, details: 'SSH error: SSH session disconnected' } }),
    );
    render(<Harness />);
    const card = await open(GLM);
    expect(
      await within(card).findByText(/remote folder was disconnected while it was being read/),
    ).toBeInTheDocument();
    expect(within(card).getByTestId('dataset-card-reconnect')).toHaveTextContent('Reconnect');
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The Files header can say so too: the mount is known to be down.
    expect(useRemoteConnectionStore.getState().down).toEqual({ [MOUNT]: true });

    // Reconnected from any surface: the card loads again by itself.
    cards.set(GLM, glmCard());
    await act(async () => {
      markRemoteMountActive(MOUNT);
    });
    expect(await within(card).findByText('What is in the folder')).toBeInTheDocument();
    expect(within(card).queryByTestId('dataset-card-reconnect')).toBeNull();
  });

  it('keeps Retry alone for a card that failed for another reason, and does not reload it', async () => {
    const { markRemoteMountActive, resetRemoteConnectionStore } = await import(
      '@/stores/remoteConnectionStore'
    );
    resetRemoteConnectionStore();
    render(<Harness />);
    const card = await open(GLM); // no such card: 8263
    await within(card).findByText('This could not be read. It may have moved or been deleted.');
    expect(within(card).queryByTestId('dataset-card-reconnect')).toBeNull();
    const reads = invoke.mock.calls.filter(([cmd]) => cmd === 'get_dataset_card').length;
    await act(async () => {
      markRemoteMountActive(MOUNT);
    });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'get_dataset_card')).toHaveLength(reads);
  });
});
