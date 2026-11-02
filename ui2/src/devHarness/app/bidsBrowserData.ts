/**
 * Synthetic 40-participant dataset for the BIDS browser, ported from
 * docs/plans/bids-browser-mockups/src/data.js with the same seeded generator,
 * shaped as the `scan_bids_browser` contract. Nothing here is real data.
 *
 * Variant letters follow the bridge, per series with the modal group excluded,
 * so the mock's bold groups B and C are A and B of each task series and T1w
 * group D is A of T1w. `freesurfer` is stale, which the mock has no example of.
 */
import type {
  BidsBrowserIndex,
  BidsCheck,
  BidsExclusion,
  BidsExclusionKey,
  BidsExclusionWrite,
  BidsFdSummary,
  BidsFinding,
  BidsMetaValue,
  BidsRunDetail,
  BidsRunRecord,
  BidsScanProgress,
  BidsSeriesModal,
  BidsSubjectDerivative,
  BidsVariantGroup,
} from '@brainflow/api';

export const BIDS_BROWSER_ROOT = '/harness/wm-reward';

function mulberry(seedValue: number): () => number {
  let seed = seedValue;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const N = 40;
const MISSING_S2 = new Set([11, 26, 31, 37, 38]);

interface Subject {
  n: number;
  id: string;
  group: string;
  age: number;
  sex: string;
  hand: string;
  fdS: Record<string, number | null>;
  tsnr: number;
  tsnrS: Record<string, number | null>;
  s2: boolean;
  upgraded: boolean;
  isNew: boolean;
}

function buildSubjects(count: number): Subject[] {
  const R = mulberry(11);
  const subjects: Subject[] = [];
  for (let n = 1; n <= count; n++) {
    const patient = R() < 0.46;
    const age = Math.round(patient ? 27 + R() * 37 : 19 + R() * 26);
    const sex = R() < 0.52 ? 'F' : 'M';
    const hand = R() < 0.9 ? 'R' : 'L';
    let fd = +(0.08 + R() * 0.12 + (patient ? 0.04 : 0)).toFixed(2);
    let tsnr = Math.round(52 + R() * 16 - (patient ? 3 : 0));
    if (n === 7) fd = 0.61;
    if (n === 33) fd = 0.48;
    if (n === 21) fd = 0.37;
    if (n === 14) tsnr = 31;
    const j = R();
    const fd1 = +(fd + (j - 0.5) * 0.03).toFixed(2);
    let fd2 = MISSING_S2.has(n) ? null : +(fd + (R() - 0.5) * 0.03 - (n >= 29 ? 0.03 : 0)).toFixed(2);
    if (n === 7) fd2 = 0.64;
    if (n === 33) fd2 = 0.51;
    subjects.push({
      n,
      id: pad(n),
      group: patient ? 'patient' : 'control',
      age,
      sex,
      hand,
      tsnr,
      fdS: { '01': n === 33 ? 0.44 : n === 7 ? 0.58 : fd1, '02': fd2 },
      tsnrS: {
        '01': tsnr,
        '02': MISSING_S2.has(n) ? null : n === 14 ? 55 : tsnr + (n >= 29 ? 6 : 0),
      },
      s2: !MISSING_S2.has(n),
      upgraded: n >= 29,
      isNew: n >= count - 2,
    });
  }
  return subjects;
}

type SeriesKey = 'T1w' | 'T2w' | 'nback' | 'mid' | 'rest' | 'dwi' | 'fmap';

interface SeriesSpec {
  datatype: string;
  suffix: string;
  task?: string;
  tr: number;
  te: number;
  multiband?: number;
  voxel: string;
  matrix: string;
  volumes?: number;
  pe?: string;
}

const SERIES: Record<SeriesKey, SeriesSpec> = {
  T1w: { datatype: 'anat', suffix: 'T1w', tr: 2.4, te: 0.00222, voxel: '0.800x0.800x0.800', matrix: '208x300x320' },
  T2w: { datatype: 'anat', suffix: 'T2w', tr: 3.2, te: 0.563, voxel: '0.800x0.800x0.800', matrix: '208x300x320' },
  nback: { datatype: 'func', suffix: 'bold', task: 'nback', tr: 0.8, te: 0.03, multiband: 6, voxel: '2.400x2.400x2.400', matrix: '90x90x60', volumes: 412, pe: 'j-' },
  mid: { datatype: 'func', suffix: 'bold', task: 'mid', tr: 0.8, te: 0.03, multiband: 6, voxel: '2.400x2.400x2.400', matrix: '90x90x60', volumes: 520, pe: 'j-' },
  rest: { datatype: 'func', suffix: 'bold', task: 'rest', tr: 0.8, te: 0.03, multiband: 6, voxel: '2.400x2.400x2.400', matrix: '90x90x60', volumes: 750, pe: 'j-' },
  dwi: { datatype: 'dwi', suffix: 'dwi', tr: 3.23, te: 0.089, voxel: '1.500x1.500x1.500', matrix: '140x140x92', volumes: 98 },
  fmap: { datatype: 'fmap', suffix: 'epi', tr: 7.2, te: 0.066, voxel: '2.400x2.400x2.400', matrix: '90x90x60', volumes: 3 },
};

interface Column {
  ses: string;
  key: SeriesKey;
  run?: number;
  i: number;
}

const COLS: Column[] = (
  [
    ['01', 'T1w'],
    ['01', 'T2w'],
    ['01', 'nback', 1],
    ['01', 'nback', 2],
    ['01', 'mid', 1],
    ['01', 'mid', 2],
    ['01', 'rest', 1],
    ['01', 'dwi'],
    ['01', 'fmap'],
    ['02', 'nback', 1],
    ['02', 'nback', 2],
    ['02', 'mid', 1],
    ['02', 'mid', 2],
    ['02', 'rest', 1],
    ['02', 'fmap'],
  ] as Array<[string, SeriesKey, number?]>
).map(([ses, key, run], i) => ({ ses, key, run, i }));

const isMissing = (s: Subject, c: Column) =>
  (c.ses === '02' && !s.s2) ||
  (s.n === 22 && c.ses === '01' && c.key === 'T2w') ||
  (s.n === 34 && c.ses === '02' && c.key === 'mid' && c.run === 2);

const isFunc = (c: Column) => SERIES[c.key].datatype === 'func';

/** Run-level QC, keyed `n:column`, with the mock's generator and call order. */
function buildRunQc(subjects: Subject[]) {
  const qc = new Map<string, { fd: number; tsnr: number; ghost: number }>();
  for (const s of subjects) {
    for (const c of COLS.filter(isFunc)) {
      if (isMissing(s, c)) continue;
      const r = mulberry(s.n * 97 + c.i * 13);
      const fd = Math.max(0.04, +((s.fdS[c.ses] ?? 0) + (r() - 0.5) * 0.09).toFixed(2));
      let tsnr = Math.round((s.tsnrS[c.ses] ?? s.tsnr) + (r() - 0.5) * 7);
      if (s.n === 14 && c.ses === '01') tsnr = 29 + Math.round(r() * 4);
      const ghost =
        s.n === 5 && c.ses === '01' && c.key === 'nback' && c.run === 1 ? 0.21 : +(0.03 + r() * 0.05).toFixed(2);
      qc.set(`${s.n}:${c.i}`, { fd, tsnr, ghost });
    }
  }
  return qc;
}

/** Per-volume FD whose mean is exactly `mean`, with a leading n/a as fMRIPrep writes. */
function fdTrace(seed: number, length: number, mean: number): Array<number | null> {
  const r = mulberry(seed);
  const spikes = new Set([61, 62, 148, 149, 201, 264]);
  const raw: number[] = [];
  for (let i = 1; i < length; i++) {
    raw.push(Math.max(0, mean * 0.6 + r() * mean * 0.8 + (spikes.has(i) && mean > 0.3 ? 0.9 + r() * 0.8 : 0)));
  }
  const scale = mean / (raw.reduce((a, b) => a + b, 0) / raw.length);
  return [null, ...raw.map((value) => value * scale)];
}

function fdSummary(trace: Array<number | null>, nonSteady: number[]): BidsFdSummary {
  const present = trace.filter((value): value is number => value !== null);
  const bins = Array.from({ length: 28 }, (_, bin) => {
    const start = Math.floor((bin * trace.length) / 28);
    const end = Math.max(Math.floor(((bin + 1) * trace.length) / 28), start + 1);
    return Math.max(0, ...trace.slice(start, end).map((value) => value ?? 0));
  });
  const max = Math.max(...present);
  const flagged = new Set(nonSteady);
  const steady = trace.map((value, i) => (flagged.has(i) || flagged.has(i - 1) ? null : value));
  const steadyMax = Math.max(...steady.map((value) => value ?? -1));
  const leading = nonSteady.filter((volume, i) => volume === i).length;
  return {
    mean: present.reduce((a, b) => a + b, 0) / present.length,
    max,
    n_frames: present.length,
    over_0_2: present.filter((value) => value > 0.2).length,
    over_0_5: present.filter((value) => value > 0.5).length,
    peak_volume: steadyMax >= 0 ? steady.indexOf(steadyMax) : trace.indexOf(max),
    first_valid_volume: leading < trace.length ? leading : 0,
    non_steady_volumes: nonSteady,
    trace: bins,
    source: 'fmriprep 24.1.1 confounds',
    definition: 'Power',
    filtered: false,
  };
}

const sliceTiming = Array.from({ length: 10 }, (_, i) => +(i * 0.08).toFixed(2));

interface Acquisition {
  tr: number;
  multiband?: number;
  pe?: string;
  software: string;
  voxel: string;
  volumes?: number;
  timing: boolean;
  /** Which sidecar overrides the dataset-level values. */
  override: boolean;
}

function acquisition(s: Subject, c: Column): Acquisition {
  const spec = SERIES[c.key];
  const out: Acquisition = {
    tr: spec.tr,
    multiband: spec.multiband,
    pe: spec.pe,
    software: 'XA30',
    voxel: spec.voxel,
    volumes: spec.volumes,
    timing: spec.suffix === 'bold',
    override: false,
  };
  if (isFunc(c) && c.ses === '02' && s.upgraded) {
    out.tr = 1.0;
    out.multiband = 4;
    out.software = 'XA50';
    out.volumes = Math.floor(((spec.volumes ?? 0) * spec.tr) / 1.0);
    out.override = true;
  }
  if (isFunc(c) && s.n === 12 && c.ses === '01') {
    out.pe = 'j';
    out.override = true;
  }
  if (s.n === 23 && c.key === 'T1w') {
    out.voxel = '1.000x1.000x1.200';
    out.override = true;
  }
  if (s.n === 7 && c.key === 'nback' && c.ses === '02' && c.run === 2) out.volumes = 287;
  if (s.n === 16 && c.key === 'nback' && c.ses === '01' && c.run === 1) out.timing = false;
  return out;
}

function stem(s: Subject, c: Column, dir?: string, run?: number): string {
  const spec = SERIES[c.key];
  const parts = [`sub-${s.id}`, `ses-${c.ses}`];
  if (spec.task) parts.push(`task-${spec.task}`);
  if (dir) parts.push(`dir-${dir}`);
  const runNumber = run ?? c.run;
  if (runNumber) parts.push(`run-${runNumber}`);
  parts.push(spec.suffix);
  return parts.join('_');
}

function seriesName(c: Column, dir?: string): string {
  const spec = SERIES[c.key];
  if (spec.task) return `task-${spec.task}_bold`;
  return dir ? `${spec.suffix}_dir-${dir}` : spec.suffix;
}

interface BuiltRun {
  record: BidsRunRecord;
  fdValues: Array<number | null>;
  nonSteady: number[];
}

function buildRun(
  s: Subject,
  c: Column,
  qc: { fd: number; tsnr: number; ghost: number } | undefined,
  dir?: string,
  run?: number,
): BuiltRun {
  const spec = SERIES[c.key];
  const acq = acquisition(s, c);
  const id = stem(s, c, dir, run);
  const rel = `sub-${s.id}/ses-${c.ses}/${spec.datatype}/${id}.nii.gz`;
  const inherited = spec.task ? `task-${spec.task}_bold.json` : `${spec.suffix}.json`;
  const own = rel.replace('.nii.gz', '.json');
  const meta = (key: string, value: unknown, overridden = false): BidsMetaValue => ({
    key,
    value: JSON.stringify(value),
    source: overridden ? own : inherited,
    source_kind: overridden ? 'run' : 'dataset',
  });
  const nifti = (key: string, value: unknown): BidsMetaValue => ({
    key,
    value: JSON.stringify(value),
    source: 'NIfTI',
    source_kind: 'nifti',
  });
  const sidecar: BidsMetaValue[] = [
    meta('RepetitionTime', acq.tr, acq.override),
    meta('EchoTime', spec.te),
    meta('Manufacturer', 'Siemens'),
    meta('ManufacturersModelName', 'Prisma'),
    meta('MagneticFieldStrength', 3),
    meta('SoftwareVersions', acq.software, acq.override),
  ];
  if (acq.multiband) sidecar.push(meta('MultibandAccelerationFactor', acq.multiband, acq.override));
  if (acq.pe) sidecar.push(meta('PhaseEncodingDirection', acq.pe, acq.override));
  if (acq.timing) sidecar.push(meta('SliceTiming', sliceTiming));
  if (spec.suffix === 'bold') {
    sidecar.push(meta('TotalReadoutTime', 0.05), meta('B0FieldSource', `pepolar_ses-${c.ses}`, true));
  }
  if (c.key === 'fmap') {
    sidecar.push(
      meta('PhaseEncodingDirection', dir === 'AP' ? 'j-' : 'j', true),
      meta('TotalReadoutTime', 0.05),
      meta('B0FieldIdentifier', `pepolar_ses-${c.ses}`, true),
    );
  }
  sidecar.push(nifti('VoxelSize', acq.voxel), nifti('Matrix', spec.matrix));
  if (acq.volumes) sidecar.push(nifti('NumberOfVolumes', acq.volumes), nifti('pixdim[4]', acq.tr));

  const voxel = acq.voxel.split('x').map(Number);
  const matrix = spec.matrix.split('x').map(Number);
  const fdValues = qc ? fdTrace(s.n * 1009 + c.i, acq.volumes ?? 0, qc.fd) : [];
  const nonSteady = fdValues.length > 0 && s.n % 7 === 0 ? (s.n % 2 === 0 ? [0, 1] : [0]) : [];
  const variant =
    isFunc(c) && acq.override
      ? s.n === 12
        ? 'B'
        : 'A'
      : s.n === 23 && c.key === 'T1w'
        ? 'A'
        : null;
  const record: BidsRunRecord = {
    id,
    subject: s.id,
    session: c.ses,
    datatype: spec.datatype,
    suffix: spec.suffix,
    task: spec.task ?? null,
    acq: null,
    dir: dir ?? null,
    run: (run ?? c.run)?.toString() ?? null,
    echo: null,
    path: `${BIDS_BROWSER_ROOT}/${rel}`,
    rel_path: rel,
    size_bytes: spec.datatype === 'anat' ? 14_680_064 : 98_566_144,
    series: seriesName(c, dir),
    sidecar,
    header: {
      dim: acq.volumes ? [...matrix, acq.volumes] : matrix,
      pixdim: acq.volumes ? [...voxel, acq.tr] : voxel,
      qform_code: 1,
      sform_code: 1,
      tr_seconds: acq.volumes ? acq.tr : null,
      n_volumes: acq.volumes ?? null,
    },
    variant_id: variant,
    fmap: null,
    fd: qc ? fdSummary(fdValues, nonSteady) : null,
    iqms: qc
      ? { tsnr: qc.tsnr, fd_mean: qc.fd, gsr_y: qc.ghost, source: 'mriqc 24.0.2' }
      : null,
    has_events: spec.task === 'nback' || spec.task === 'mid',
    mtime: '2026-10-12T09:00:00Z',
  };
  return { record, fdValues, nonSteady };
}

const check = (ok: boolean, text: string, severity = 'warning'): BidsCheck => ({
  ok,
  severity: ok ? 'ok' : severity,
  text,
});

function linkFieldmap(record: BidsRunRecord, s: Subject) {
  if (record.suffix !== 'bold') return;
  const session = record.session;
  const pair = ['AP', 'PA'].map((d) => `sub-${s.id}_ses-${session}_dir-${d}_epi`);
  const reversed = s.n === 12 && session === '01';
  record.fmap = {
    source_id: `pepolar_ses-${session}`,
    fmap_run_ids: pair,
    via: 'B0FieldSource',
    checks: [
      reversed
        ? check(false, 'Phase encoding is not opposed (j-, j, j)')
        : check(true, 'Phase encoding directions are opposed'),
      check(true, 'TotalReadoutTime matches'),
      check(true, "Field map shares the run's grid"),
      check(true, 'Field map is from the same session'),
    ],
  };
}

function finding(
  tag: string,
  severity: string,
  code: string,
  sub: number | null,
  ses: string | null,
  runIds: string[],
  title: string,
  detail: string,
  file: string | null = null,
): BidsFinding {
  return {
    id: `${code}:${sub ?? 'dataset'}:${ses ?? ''}:${runIds[0] ?? ''}`,
    tag,
    severity,
    code,
    title,
    detail,
    subject: sub === null ? null : pad(sub),
    session: ses,
    run_ids: runIds,
    file,
  };
}

function buildFindings(): BidsFinding[] {
  const task = (sub: number, ses: string, name: string, run: number) =>
    `sub-${pad(sub)}_ses-${ses}_task-${name}_run-${run}_bold`;
  return [
    finding('validator', 'error', 'DWI_MISSING_BVEC', 35, '01', ['sub-35_ses-01_dwi'], 'Missing .bvec',
      'sub-35_ses-01_dwi.nii.gz has a .bval but no .bvec. Tractography and eddy will fail.'),
    finding('content', 'error', 'INTENDEDFOR_BROKEN', 4, '02', ['sub-04_ses-02_dir-AP_epi'],
      'IntendedFor points to a missing file',
      'fmap epi dir-AP lists bids::sub-04/ses-02/func/sub-04_ses-02_task-mid_run-2_bold.nii.gz, which does not exist.',
      'bids::sub-04/ses-02/func/sub-04_ses-02_task-mid_run-2_bold.nii.gz'),
    finding('content', 'warning', 'TRUNCATED_RUN', 7, '02', [task(7, '02', 'nback', 2)],
      'Truncated run: 287 of 412 volumes', 'Run ends at 229.6 s; 21 events fall after the last volume.'),
    finding('content', 'warning', 'EVENTS_AFTER_SCAN', 28, '01', [task(28, '01', 'mid', 1)],
      '3 events after scan end', 'Last onset 431.2 s, run duration 416.0 s. Check the events onset reference.'),
    finding('content', 'warning', 'SLICE_TIMING_MISSING', 16, '01', [task(16, '01', 'nback', 1)],
      'SliceTiming missing', 'No sidecar in the chain gives SliceTiming. Other task-nback_bold runs have it (10 unique times).'),
    finding('note', 'info', 'EXTRA_RUN', 9, '01', ['sub-09_ses-01_task-rest_run-2_bold'], 'Extra rest run',
      'rest run-2 exists only for sub-09. scans.tsv notes "reacquired: participant asleep".'),
    finding('note', 'info', 'SIDECAR_UNDOCUMENTED', null, null, [], 'participants.tsv column "hand" undocumented',
      'Add a description and levels to participants.json.', 'participants.tsv'),
  ];
}

function buildVariants(runs: BidsRunRecord[], modal: BidsSeriesModal[]): BidsVariantGroup[] {
  const groups: BidsVariantGroup[] = [];
  for (const { series } of modal) {
    const own = runs.filter((run) => run.series === series && run.variant_id);
    for (const id of ['A', 'B']) {
      const members = own.filter((run) => run.variant_id === id).map((run) => run.id);
      if (!members.length) continue;
      if (series === 'T1w') {
        groups.push({
          id,
          series,
          name: 'Voxel differs',
          diff: 'Voxel 1.000x1.000x1.200 (modal 0.800x0.800x0.800)',
          note: 'Spatial resolution differs from the modal group.',
          keys: ['VoxelSize'],
          run_ids: members,
        });
      } else if (id === 'A') {
        groups.push({
          id,
          series,
          name: 'TR, MB, Software differs',
          diff: 'TR 1 (modal 0.8) · MB 4 (modal 6) · Software XA50 (modal XA30)',
          note: 'FD is not comparable with the modal group without a caveat or filtered FD. Reconstruction software differs from the modal group.',
          keys: ['RepetitionTime', 'MultibandAccelerationFactor', 'SoftwareVersions'],
          run_ids: members,
        });
      } else {
        groups.push({
          id,
          series,
          name: 'PE differs',
          diff: 'PE j (modal j-)',
          note: 'Distortion runs along a different direction; field map pairing must follow it.',
          keys: ['PhaseEncodingDirection'],
          run_ids: members,
        });
      }
    }
  }
  return groups;
}

/** `current` is what the design calls blank. */
function derivativeStatus(subjects: Subject[]): BidsSubjectDerivative[] {
  return subjects.flatMap((s) => [
    { subject: s.id, name: 'fmriprep', status: s.isNew ? 'missing' : s.n === 7 ? 'partial' : 'current' },
    { subject: s.id, name: 'mriqc', status: 'current' },
    { subject: s.id, name: 'freesurfer', status: s.isNew ? 'missing' : s.n === 12 ? 'stale' : 'current' },
  ]);
}

function scope(entity: string): string {
  const parts = entity.split('_');
  if (parts.length === 1) return 'participant';
  return parts.length === 2 && parts[1].startsWith('ses-') ? 'session' : 'run';
}

const EXCLUSION_SEED: BidsExclusion = {
  entity: 'sub-07_ses-02_task-nback_run-2_bold',
  scope: 'run',
  reason: 'Truncated run (287/412 vols); mean FD 0.64 mm',
  criterion: 'manual',
  value: '0.64',
  author: 'bb',
  date: '2026-10-30',
  source: 'fmriprep 24.1.1 confounds',
  threshold: '',
  definition: 'Power',
  triggered_by: '',
};

const SCAN_DESIGN: Record<string, { duration: number; events: Array<[number, number, string]> }> = {
  nback: {
    duration: 329.6,
    events: ['0back', '2back', '0back', '2back', '2back', '0back', '2back', '0back'].flatMap((type, i) => [
      [12 + i * 40, 30, type] as [number, number, string],
      [42 + i * 40, 10, 'fixation'] as [number, number, string],
    ]),
  },
  mid: { duration: 416, events: buildMidEvents() },
};

function buildMidEvents(): Array<[number, number, string]> {
  const r = mulberry(5);
  const out: Array<[number, number, string]> = [];
  let t = 8;
  while (t < 404) {
    const u = r();
    out.push([t, 2, u < 0.4 ? 'gain' : u < 0.8 ? 'loss' : 'neutral']);
    t += 4 + Math.round(r() * 3);
  }
  return out;
}

export interface BidsBrowserDataset {
  index(scanId: string): BidsBrowserIndex;
  /** Per-subject progress events, in scan order. */
  progress(scanId: string): BidsScanProgress[];
  /** The index as a scan cancelled after `subjects` subjects reports it. */
  partial(scanId: string, subjects: number): BidsBrowserIndex;
  detail(runId: string): BidsRunDetail;
  /** Event rows in the `get_bids_events` shape. */
  events(task: string | undefined): Array<{
    onset: number;
    duration: number;
    trial_type: string;
    additional: Record<string, string>;
  }>;
  readExclusions(): BidsExclusion[];
  writeExclusions(rows: BidsExclusion[]): BidsExclusionWrite;
  revertExclusions(keys: BidsExclusionKey[]): BidsExclusion[];
}

/** Deterministic: two calls return equal data. Exclusions live per instance. */
export function createBidsBrowserDataset(
  participants = N,
  options: { seedExclusion?: boolean } = {},
): BidsBrowserDataset {
  const subjects = buildSubjects(participants);
  const runQc = buildRunQc(subjects);
  const built: BuiltRun[] = [];
  for (const s of subjects) {
    for (const c of COLS) {
      if (isMissing(s, c)) continue;
      const qc = runQc.get(`${s.n}:${c.i}`);
      if (c.key === 'fmap') {
        for (const dir of ['AP', 'PA']) built.push(buildRun(s, c, undefined, dir));
        continue;
      }
      built.push(buildRun(s, c, qc));
      // The mock's one extra run: sub-09 rest run-2.
      if (s.n === 9 && c.key === 'rest' && c.ses === '01') built.push(buildRun(s, c, qc, undefined, 2));
    }
    for (const { record } of built.filter((b) => b.record.subject === s.id)) linkFieldmap(record, s);
  }
  const runs = built.map((b) => b.record);
  const findings = buildFindings();
  const seriesNames = [...new Set(runs.map((run) => run.series))].sort();
  const modal: BidsSeriesModal[] = seriesNames.map((series) => {
    const members = runs.filter((run) => run.series === series);
    const reference = members.find((run) => !run.variant_id) ?? members[0];
    return {
      series,
      values: reference.sidecar.filter(
        (entry) => !['B0FieldIdentifier', 'B0FieldSource', 'IntendedFor'].includes(entry.key),
      ),
      n_runs: members.length,
    };
  });
  const variants = buildVariants(runs, modal);
  let exclusions: BidsExclusion[] = options.seedExclusion === false ? [] : [EXCLUSION_SEED];

  const bold = runs.filter((run) => run.suffix === 'bold');
  const processed = bold.filter((run) => !subjects[Number(run.subject) - 1].isNew);
  const partialRun = 'sub-07_ses-01_task-rest_run-1_bold';
  const index = (scanId: string): BidsBrowserIndex => ({
    scan_id: scanId,
    dataset_path: BIDS_BROWSER_ROOT,
    name: 'Working memory and reward',
    bids_version: '1.9.0',
    dataset_version: '1.2.0',
    doi: '10.18112/example.v1.2.0',
    license: 'CC0',
    authors: ['A. Example', 'B. Placeholder', 'C. Synthetic'],
    scanner: 'Siemens Prisma 3T',
    is_remote: false,
    listing_complete: true,
    complete: true,
    default_author: 'bb',
    previous_scan_at: '2026-10-28T09:30:00Z',
    new_subjects: subjects.filter((s) => s.isNew).map((s) => s.id),
    total_file_count: 1071,
    total_size_bytes: 182.4 * 2 ** 30,
    files_read: 1071,
    files_opened: 1071,
    session_order: [],
    participants: subjects.map((s) => ({
      participant_id: s.id,
      values: { group: s.group, age: String(s.age), sex: s.sex, hand: s.hand },
    })),
    participant_columns: ['group', 'age', 'sex', 'hand'],
    subjects: subjects.map((s) => s.id),
    runs,
    series_modal: modal,
    variants,
    findings,
    derivatives: [
      { name: 'fmriprep', version: '24.1.1', source_version: '1.2.0', stale: false,
        runs: processed.filter((run) => run.id !== partialRun).length, of: bold.length, unit: 'run',
        root: 'derivatives/fmriprep' },
      { name: 'mriqc', version: '24.0.2', source_version: '1.2.0', stale: false,
        runs: bold.length, of: bold.length, unit: 'run', root: 'derivatives/mriqc' },
      { name: 'freesurfer', version: '7.4.1', source_version: '1.2.0', stale: false,
        runs: subjects.filter((s) => !s.isNew).length, of: participants, unit: 'subject', root: 'derivatives/freesurfer' },
    ],
    derivative_status: derivativeStatus(subjects),
    exclusions: [...exclusions],
    exclusions_described: exclusions.length > 0,
  });

  return {
    index,
    progress: (scanId) => {
      let filesDone = 0;
      return subjects.map((s, position) => {
        const own = runs.filter((run) => run.subject === s.id);
        filesDone += own.length;
        return {
          scan_id: scanId,
          is_remote: false,
          listing_complete: true,
          phase: 'subjects',
          subjects_done: position + 1,
          subjects_total: participants,
          files_done: filesDone,
          files_total: 1071,
          current: own[own.length - 1]?.rel_path ?? null,
          subject: s.id,
          // Series results only arrive in the final index, as from the bridge.
          runs: own.map((run) => ({ ...run, variant_id: null })),
          findings: findings.filter((item) => item.subject === s.id && item.tag !== 'validator'),
        };
      });
    },
    partial: (scanId, count) => {
      const read = new Set(subjects.slice(0, count).map((s) => s.id));
      const whole = index(scanId);
      const kept = whole.runs.filter((run) => read.has(run.subject));
      const keptIds = new Set(kept.map((run) => run.id));
      return {
        ...whole,
        complete: false,
        runs: kept,
        findings: whole.findings.filter((item) => item.subject !== null && read.has(item.subject)),
        variants: whole.variants
          .map((group) => ({ ...group, run_ids: group.run_ids.filter((id) => keptIds.has(id)) }))
          .filter((group) => group.run_ids.length > 0),
      };
    },
    detail: (runId) => {
      const run = built.find((item) => item.record.id === runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);
      const task = run.record.task ?? '';
      const design = SCAN_DESIGN[task];
      const hasRun = run.fdValues.length > 0;
      const short = runId === 'sub-07_ses-02_task-nback_run-2_bold';
      const late = runId === 'sub-28_ses-01_task-mid_run-1_bold';
      return {
        run_id: runId,
        fd_trace: run.fdValues,
        fd_source: hasRun ? 'fmriprep 24.1.1 confounds' : null,
        fd_definition: hasRun ? 'Power' : null,
        fd_filtered: false,
        non_steady_volumes: run.nonSteady,
        event_checks: design
          ? [
              check(true, 'Required onset and duration columns present'),
              check(true, 'Every onset has a value'),
              short || late
                ? check(false, short ? '21 events after scan end' : '3 events after scan end')
                : check(true, `All events end within the scan (${design.duration.toFixed(1)} s)`),
              check(true, 'trial_type levels match events.json'),
              check(true, 'response_time missing for 3 of 128 events (2%)'),
            ]
          : [],
        events_duration: design ? Math.max(...design.events.map(([onset, length]) => onset + length)) : null,
        derivative_checks: [
          check(true, 'fmriprep 24.1.1: built from 1.2.0'),
          check(true, 'mriqc 24.0.2: built from 1.2.0'),
          run.record.subject === '12'
            ? check(false, 'freesurfer 7.4.1: built from 1.1.0, raw is 1.2.0')
            : check(true, 'freesurfer 7.4.1: built from 1.2.0'),
        ],
      };
    },
    events: (task) =>
      (SCAN_DESIGN[task ?? '']?.events ?? []).map(([onset, duration, trial_type]) => ({
        onset,
        duration,
        trial_type,
        additional: {},
      })),
    readExclusions: () => [...exclusions],
    writeExclusions: (rows) => {
      const added: BidsExclusion[] = [];
      for (const row of rows) {
        if (!/^sub-[A-Za-z0-9_-]+$/.test(row.entity)) throw new Error(`Invalid exclusion entity: ${row.entity}`);
        const duplicate = exclusions.some((old) => old.entity === row.entity && old.criterion === row.criterion);
        if (!duplicate) {
          const stored = { ...row, scope: scope(row.entity) };
          exclusions = [...exclusions, stored];
          added.push(stored);
        }
      }
      return { all: [...exclusions], added };
    },
    revertExclusions: (keys) => {
      exclusions = exclusions.filter(
        (row) => !keys.some((key) => key.entity === row.entity && key.criterion === row.criterion),
      );
      return [...exclusions];
    },
  };
}

/** Deterministic phantom slice, grey values only: an ellipse with a darker core. */
export function bidsPhantomRgba(key: string, size: number): Uint8ClampedArray {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  const r = mulberry(hash);
  const lean = 0.9 + r() * 0.2;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const d = Math.hypot(u / (0.36 * lean), v / 0.44);
      const core = Math.hypot((Math.abs(u) - 0.08) / 0.05, v / 0.16);
      const grey = d > 1 ? 0 : core < 1 ? 70 : 190 - 60 * d;
      const at = (y * size + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = grey;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

/** Deterministic carpet: greys with one bright line per FD spike. */
export function bidsCarpetRgba(key: string, width: number, height: number): Uint8ClampedArray {
  const r = mulberry(key.length * 131);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const spikes = new Set([Math.floor(width * 0.2), Math.floor(width * 0.55)]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grey = spikes.has(x) ? 230 : 90 + r() * 70;
      const at = (y * width + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = grey;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

/**
 * `?bidsStream=<ms>` turns `scan_bids_browser` into a stream of one subject per
 * interval; `?bidsStream=hold-<n>` delivers n subjects at once and then waits for
 * `cancel_bids_scan`, for a stable "so far" capture. Without it a scan returns at
 * once and no progress events fire, as the v1 scenario expects.
 */
export function bidsStreamPlan(search: string): { delayMs: number; holdAfter: number | null } | null {
  const value = new URLSearchParams(search).get('bidsStream');
  if (value === null) return null;
  const hold = /^hold-(\d+)$/.exec(value);
  if (hold) return { delayMs: 0, holdAfter: Number(hold[1]) };
  const delayMs = Number(value);
  return Number.isFinite(delayMs) && delayMs >= 0 ? { delayMs, holdAfter: null } : null;
}

type Listener = (event: { event: string; payload: unknown }) => void;

/** What `safeListen` routes to in the harness; see `ui2/src/utils/eventUtils.ts`. */
export interface HarnessEventBus {
  listen(event: string, handler: Listener): () => void;
  emit(event: string, payload: unknown): void;
}

export function installHarnessEventBus(target: { __harnessEvents?: HarnessEventBus }): HarnessEventBus {
  const listeners = new Map<string, Set<Listener>>();
  const bus: HarnessEventBus = {
    listen: (event, handler) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      listeners.set(event, set);
      set.add(handler);
      return () => void set.delete(handler);
    },
    emit: (event, payload) => {
      for (const handler of [...(listeners.get(event) ?? [])]) handler({ event, payload });
    },
  };
  target.__harnessEvents = bus;
  return bus;
}

/**
 * Drive one streamed scan. Resolves with the final index, or the partial one
 * when `cancelled()` turns true.
 */
export async function streamBidsScan(
  dataset: BidsBrowserDataset,
  scanId: string,
  plan: { delayMs: number; holdAfter: number | null },
  emit: (progress: BidsScanProgress) => void,
  cancelled: () => boolean,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<BidsBrowserIndex> {
  const steps = dataset.progress(scanId);
  let done = 0;
  for (const step of steps) {
    if (cancelled()) return dataset.partial(scanId, done);
    if (plan.holdAfter !== null && done >= plan.holdAfter) {
      while (!cancelled()) await sleep(50);
      return dataset.partial(scanId, done);
    }
    emit(step);
    done += 1;
    if (plan.delayMs > 0) await sleep(plan.delayMs);
  }
  return dataset.index(scanId);
}
