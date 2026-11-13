import { describe, expect, it } from 'vitest';
import type { DatasetAnalysis, DatasetContents } from '@brainflow/api';
import type { FileTreeNode } from '@/types/filesystem';
import {
  analysesLabel,
  analysisGeneratedBy,
  analysisSubjects,
  analysisTable,
  collectionHint,
  contentTotals,
  displayPath,
  filterAnalysisRows,
  kindCount,
  sharedTitlePrefix,
  showsAsCollection,
  sortAnalysisRows,
  stableAnalysisOrder,
} from '../datasetCardFormat';

function analysis(folderName: string, patch: Partial<DatasetAnalysis> = {}): DatasetAnalysis {
  return {
    path: `/d/derivatives/${folderName}`,
    folderName,
    title: null,
    generatedBy: null,
    subjectCount: 0,
    subjectCountTruncated: false,
    hasGroupLevel: false,
    hasDescription: true,
    issue: null,
    date: null,
    ...patch,
  };
}

function contents(patch: Partial<DatasetContents> = {}): DatasetContents {
  return {
    subjectCount: 35,
    sessionCount: 0,
    tasks: [],
    spaces: [],
    imageCount: 105,
    hasGroupLevel: false,
    groupImageCount: 0,
    imageKinds: [],
    imageKindCount: 3,
    truncated: false,
    truncatedReason: null,
    ...patch,
  };
}

describe('displayPath', () => {
  const MOUNT = '/cache/mounts/m1';
  const remote = (mountSource: FileTreeNode['mountSource']): FileTreeNode[] => [
    { id: MOUNT, name: 'dsets', path: MOUNT, type: 'directory', depth: 0, mountSource },
  ];

  it('says the remote root once, although the mount label already ends with it', () => {
    const entries = remote({
      kind: 'remote',
      // As the backend builds it: user@host:remote_root.
      label: 'brad@trillium.alliancecan.ca:/scratch/brad/dsets',
      host: 'trillium.alliancecan.ca',
      user: 'brad',
      port: 22,
      remotePath: '/scratch/brad/dsets',
    });
    expect(displayPath(`${MOUNT}/pcmri`, entries)).toBe(
      'brad@trillium.alliancecan.ca:/scratch/brad/dsets/pcmri',
    );
    // A file below it (the sidecar card's loading header) reads the same way.
    expect(displayPath(`${MOUNT}/pcmri/sub-01/a.nii.gz`, entries)).toBe(
      'brad@trillium.alliancecan.ca:/scratch/brad/dsets/pcmri/sub-01/a.nii.gz',
    );
    expect(displayPath(MOUNT, entries)).toBe('brad@trillium.alliancecan.ca:/scratch/brad/dsets');
  });

  it('keeps a port that is not 22, and works from the label alone', () => {
    expect(
      displayPath(
        `${MOUNT}/x`,
        remote({ kind: 'remote', host: 'h', user: 'u', port: 2222, remotePath: '/data/' }),
      ),
    ).toBe('u@h:2222:/data/x');
    expect(
      displayPath(
        `${MOUNT}/x`,
        remote({ kind: 'remote', label: 'u@h:/data', remotePath: '/data' }),
      ),
    ).toBe('u@h:/data/x');
    // A label that is only a name is used as it is.
    expect(
      displayPath(`${MOUNT}/x`, remote({ kind: 'remote', label: 'lab', remotePath: '/data' })),
    ).toBe('lab:/data/x');
    expect(displayPath(MOUNT, remote({ kind: 'remote', host: 'h', remotePath: '/' }))).toBe('h:/');
  });

  it('leaves a local path as it is', () => {
    expect(displayPath('/Users/me/data/ds', [])).toBe('/Users/me/data/ds');
    expect(displayPath(`${MOUNT}/x`, remote({ kind: 'local' }))).toBe(`${MOUNT}/x`);
  });
});

describe('marker wording', () => {
  it('says a floor in words', () => {
    expect(analysesLabel({ analysisCount: 4, analysisCountTruncated: false })).toBe('4 analyses');
    expect(analysesLabel({ analysisCount: 1, analysisCountTruncated: false })).toBe('1 analysis');
    expect(analysesLabel({ analysisCount: 24, analysisCountTruncated: true })).toBe(
      'at least 24 analyses',
    );
  });
});

describe('sharedTitlePrefix', () => {
  it('finds a prefix every title shares, up to a separator', () => {
    expect(sharedTitlePrefix(['PCMRI — Encoding RSA', 'PCMRI — Recall GLM'])).toBe('PCMRI — ');
    expect(sharedTitlePrefix(['Study: a', 'Study: b', 'Study: c'])).toBe('Study: ');
    // The longest separator-bounded prefix, not the first.
    expect(sharedTitlePrefix(['A - B - one', 'A - B - two'])).toBe('A - B - ');
  });

  it('shares nothing without a separator, with one title, or when one title differs', () => {
    expect(sharedTitlePrefix(['Encoding RSA', 'Encoding GLM'])).toBe('');
    expect(sharedTitlePrefix(['PCMRI — Encoding'])).toBe('');
    expect(sharedTitlePrefix(['PCMRI — a', 'PCMRI — b', 'Other'])).toBe('');
    expect(sharedTitlePrefix([])).toBe('');
  });

  it('never strips a title down to nothing', () => {
    expect(sharedTitlePrefix(['PCMRI — ', 'PCMRI — b'])).toBe('');
  });
});

describe('analysisGeneratedBy', () => {
  const by = (folderName: string, name: string, version: string | null = null) =>
    analysisGeneratedBy({ folderName, generatedBy: { name, version } });

  it('drops a pipeline that only repeats the folder name', () => {
    expect(by('glm_recog', 'glm_recog')).toBeNull();
    expect(by('glm_recog', 'GLM-Recog')).toBeNull();
    expect(by('enc_rep_rsa', 'enc rep rsa')).toBeNull();
    expect(analysisGeneratedBy({ folderName: 'x', generatedBy: null })).toBeNull();
  });

  it('keeps one that says something else, and a version on its own', () => {
    expect(by('glm_recog', 'fmrireg', '0.4.1')).toEqual({ name: 'fmrireg', version: '0.4.1' });
    expect(by('fmriprep', 'fMRIPrep', '23.2.1')).toEqual({ name: null, version: '23.2.1' });
  });
});

describe('analysisSubjects', () => {
  const cell = (subjectCount: number, hasGroupLevel = false, subjectCountTruncated = false) =>
    analysisSubjects({ subjectCount, hasGroupLevel, subjectCountTruncated }).text;

  it('reads on one line', () => {
    expect(cell(35)).toBe('35');
    expect(cell(35, true)).toBe('35 + group');
    expect(cell(0, true)).toBe('group only');
    expect(cell(0)).toBe('none');
    expect(cell(12, false, true)).toBe('at least 12');
    expect(cell(0, false, true)).toBe('at least 0');
  });

  it('is spoken with its unit', () => {
    expect(
      analysisSubjects({ subjectCount: 1, hasGroupLevel: true, subjectCountTruncated: false })
        .spoken,
    ).toBe('1 subject and a group level');
    expect(
      analysisSubjects({ subjectCount: 12, hasGroupLevel: false, subjectCountTruncated: true })
        .spoken,
    ).toBe('at least 12 subjects');
  });
});

describe('analysisTable', () => {
  const rows = [
    analysis('enc_rep_rsa', {
      title: 'PCMRI — Encoding RSA',
      generatedBy: { name: 'enc_rep_rsa', version: null },
      subjectCount: 35,
    }),
    analysis('glm_recog', {
      title: 'PCMRI — Recognition GLM',
      generatedBy: { name: 'GLM recog', version: null },
      subjectCount: 12,
    }),
    analysis('loose', { hasDescription: false, subjectCount: 20 }),
  ];

  it('strips the shared prefix from titled rows and keeps the full title', () => {
    const table = analysisTable(rows);
    expect(table.prefix).toBe('PCMRI — ');
    expect(table.rows.map((row) => row.title)).toEqual(['Encoding RSA', 'Recognition GLM', 'loose']);
    expect(table.rows[0].fullTitle).toBe('PCMRI — Encoding RSA');
    // An untitled folder does not stop the titled ones sharing a prefix.
    expect(table.rows[2]).toMatchObject({ named: false, fullTitle: 'loose' });
  });

  it('drops a column that would be empty in every row', () => {
    const table = analysisTable(rows);
    expect(table.showGeneratedBy).toBe(false);
    expect(table.showDate).toBe(false);
    expect(table.showFolder).toBe(true);
    expect(analysisTable([...rows, analysis('x', { date: '2026-03-04' })]).showDate).toBe(true);
    expect(
      analysisTable([analysis('a', { generatedBy: { name: 'fitlins', version: null } })])
        .showGeneratedBy,
    ).toBe(true);
    // Nothing but folder names: no second column repeating them.
    expect(analysisTable([analysis('a'), analysis('b', { title: 'b' })]).showFolder).toBe(false);
  });

  it('filters on the full title and the folder name', () => {
    const table = analysisTable(rows);
    const names = (query: string) =>
      filterAnalysisRows(table.rows, query).map((row) => row.analysis.folderName);
    expect(names('recog')).toEqual(['glm_recog']);
    expect(names('ENC_REP')).toEqual(['enc_rep_rsa']);
    // The stripped prefix still matches.
    expect(names('pcmri')).toEqual(['enc_rep_rsa', 'glm_recog']);
    expect(names('  ')).toHaveLength(3);
    expect(names('zzz')).toEqual([]);
  });

  it('sorts by name and by subjects, and keeps the folder order otherwise', () => {
    const table = analysisTable(rows);
    const order = (sort: Parameters<typeof sortAnalysisRows>[1]) =>
      sortAnalysisRows(table.rows, sort).map((row) => row.analysis.folderName);
    expect(order(null)).toEqual(['enc_rep_rsa', 'glm_recog', 'loose']);
    expect(order({ key: 'name', descending: true })).toEqual(['glm_recog', 'loose', 'enc_rep_rsa']);
    expect(order({ key: 'subjects', descending: true })).toEqual([
      'enc_rep_rsa',
      'loose',
      'glm_recog',
    ]);
    expect(order({ key: 'subjects', descending: false })).toEqual([
      'glm_recog',
      'loose',
      'enc_rep_rsa',
    ]);
  });

  it('sorts dates as written, undated rows last either way', () => {
    const dated = analysisTable([
      analysis('a', { date: '2026-01-02' }),
      analysis('b'),
      analysis('c', { date: '2025-12-31' }),
    ]).rows;
    const order = (descending: boolean) =>
      sortAnalysisRows(dated, { key: 'date', descending }).map((row) => row.analysis.folderName);
    expect(order(true)).toEqual(['a', 'c', 'b']);
    expect(order(false)).toEqual(['c', 'a', 'b']);
  });
});

describe('contentTotals', () => {
  it('says each count once, leaving out what is absent', () => {
    expect(contentTotals(contents()).map((total) => total.text)).toEqual([
      '35 subjects',
      '3 image kinds',
      '105 images',
    ]);
    expect(
      contentTotals(
        contents({ sessionCount: 2, hasGroupLevel: true, groupImageCount: 1, truncated: true }),
      ).map((total) => total.text),
    ).toEqual(['35+ subjects', '2+ sessions', '3+ image kinds', '105+ images', '1+ group-level image']);
    expect(
      contentTotals(contents({ subjectCount: 0, imageKindCount: 0, imageCount: 0, hasGroupLevel: true })).map(
        (total) => total.text,
      ),
    ).toEqual(['0 images', 'a group folder']);
    expect(contentTotals(contents({ truncated: true }))[0].spoken).toBe('at least 35 subjects');
  });
});

describe('displayPath: an IPv6 host', () => {
  const MOUNT = '/cache/mounts/m6';
  const entries = (host: string, port?: number, user?: string): FileTreeNode[] => [
    {
      id: MOUNT,
      name: 'dsets',
      path: MOUNT,
      type: 'directory',
      depth: 0,
      mountSource: { kind: 'remote', host, port, user, remotePath: '/data' },
    },
  ];

  it('is bracketed, so its colons are not taken for the one before the path', () => {
    expect(displayPath(`${MOUNT}/ds`, entries('2001:db8::7', 22, 'brad'))).toBe(
      'brad@[2001:db8::7]:/data/ds',
    );
    expect(displayPath(`${MOUNT}/ds`, entries('::1', 2222))).toBe('[::1]:2222:/data/ds');
    // Already bracketed, or not an IPv6 address: as written.
    expect(displayPath(`${MOUNT}/ds`, entries('[::1]'))).toBe('[::1]:/data/ds');
    expect(displayPath(`${MOUNT}/ds`, entries('10.0.0.7', 22, 'brad'))).toBe(
      'brad@10.0.0.7:/data/ds',
    );
  });
});

describe('what the marker says before the count', () => {
  const marker = (analysisCount: number | null) => ({ analysisCount });

  it('knows a collection from its marker, and a plain folder only where the marker looked', () => {
    expect(collectionHint(marker(4), false)).toBe(true);
    expect(collectionHint(marker(4), true)).toBe(true);
    expect(collectionHint(marker(null), false)).toBe(false);
    // A remote marker without a count did not look: nothing is known.
    expect(collectionHint(marker(null), true)).toBeNull();
    expect(collectionHint(undefined, false)).toBeNull();
  });

  it('lays a card out as a collection from the marker until it is counted', () => {
    // Before the count: the marker decides when no analysis is listed yet.
    expect(showsAsCollection(0, false, true)).toBe(true);
    expect(showsAsCollection(0, false, false)).toBe(false);
    expect(showsAsCollection(0, false, null)).toBe(false);
    expect(showsAsCollection(2, false, null)).toBe(true);
    // Counted: the card's own analyses decide, whatever the marker said.
    expect(showsAsCollection(0, true, true)).toBe(false);
    expect(showsAsCollection(3, true, false)).toBe(true);
  });
});

describe('stableAnalysisOrder', () => {
  const at = (...paths: string[]) => paths.map((path) => ({ path }));

  it('keeps listed rows in place and puts later arrivals after them', () => {
    const order = ['b', 'd'];
    expect(stableAnalysisOrder(order, at('a', 'b', 'c', 'd'))).toEqual(['b', 'd', 'a', 'c']);
    // Gone rows leave; nothing else moves.
    expect(stableAnalysisOrder(['b', 'd', 'a'], at('a', 'd'))).toEqual(['d', 'a']);
    expect(stableAnalysisOrder([], at('x', 'y'))).toEqual(['x', 'y']);
  });

  it('returns the same array when nothing changed', () => {
    const order = ['b', 'd'];
    expect(stableAnalysisOrder(order, at('d', 'b'))).toBe(order);
  });
});

describe('kindCount', () => {
  const kind = (path: string, count: number, subjectFolders: number | null = 35) => ({
    path,
    count,
    subjectFolders,
  });

  it('sets a per-subject kind against the subject folders of its level', () => {
    expect(kindCount(kind('maps/a.nii.gz', 35), contents())).toMatchObject({
      text: '35 of 35',
      missing: 0,
    });
    expect(kindCount(kind('maps/a.nii.gz', 33), contents())).toEqual({
      text: '33 of 35',
      spoken: '33 images for 35 subjects, 2 missing',
      missing: 2,
    });
  });

  it('gives the count alone where "of N" would claim too much', () => {
    // More images than subjects, sessions or runs in the path, or a walk cut short.
    expect(kindCount(kind('maps/a.nii.gz', 70), contents()).text).toBe('70');
    expect(kindCount(kind('func/sub-*_run-*_bold.nii.gz', 30), contents()).text).toBe('30');
    expect(kindCount(kind('ses-*/anat/sub-*_T1w.nii.gz', 30), contents()).text).toBe('30');
    expect(kindCount(kind('maps/a.nii.gz', 30), contents({ sessionCount: 2 })).text).toBe('30');
    expect(kindCount(kind('maps/a.nii.gz', 30), contents({ truncated: true }))).toMatchObject({
      text: '30+',
      spoken: 'at least 30 images',
      missing: 0,
    });
    expect(kindCount(kind('maps/a.nii.gz', 3, 0), contents({ subjectCount: 0 })).text).toBe('3');
  });

  it('never measures a kind against the folder’s total of subject labels', () => {
    // 35 labels in all, but only 33 subject folders where this kind lives
    // (two more come from a stray folder and a group-level file name):
    // nothing is missing.
    expect(kindCount(kind('maps/a.nii.gz', 33, 33), contents({ subjectCount: 35 }))).toEqual({
      text: '33 of 33',
      spoken: '33 images, one for each of 33 subjects',
      missing: 0,
    });
    // Its images are in no subject folder, or in those of several folders:
    // there is no number to set it against.
    expect(kindCount(kind('group/sub-*_mean.nii.gz', 2, null), contents())).toEqual({
      text: '2',
      spoken: '2 images',
      missing: 0,
    });
    // Fewer folders at its level than images of it: no claim either.
    expect(kindCount(kind('maps/a.nii.gz', 4, 3), contents()).text).toBe('4');
  });
});
