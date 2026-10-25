/** Static backend responses for the analysis and BIDS harness scenarios. */
import { HARNESS_EPOCH_MS } from './determinism';

export const BIDS_ROOT = '/harness/ds-motor';

export const ANALYSIS_DESCRIPTORS = [
  {
    id: 'builtin-copy-volume',
    name: 'Builtin: Copy Selected Volume',
    version: '0.1.0',
    api_version: '0.1',
    description: 'Copies the selected volume into a new output artifact (pipeline smoke test).',
    inputs: ['volume'],
    params_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
      title: 'No parameters',
    },
    outputs: ['volume', 'metadata'],
    runner: { type: 'builtin' },
  },
  {
    id: 'smooth-gaussian-sidecar',
    name: 'Gaussian Smoothing',
    version: '1.2.0',
    api_version: '0.1',
    description: 'Isotropic Gaussian smoothing of a scalar volume (sidecar plugin).',
    inputs: ['volume'],
    params_schema: {
      type: 'object',
      title: 'Smoothing parameters',
      properties: {
        fwhm_mm: { type: 'number', default: 6, minimum: 0, title: 'FWHM (mm)' },
        mask_to_brain: { type: 'boolean', default: true, title: 'Mask to brain' },
      },
    },
    outputs: ['volume', 'metadata'],
    runner: { type: 'sidecar' },
  },
  {
    id: 'roi-table-export',
    name: 'ROI Table Export',
    version: '0.3.1',
    api_version: '0.1',
    description: 'Summarise a volume within atlas parcels and write a table.',
    inputs: ['volume', 'roi'],
    params_schema: {
      type: 'object',
      properties: { statistic: { type: 'string', default: 'mean', enum: ['mean', 'median'] } },
    },
    outputs: ['table'],
    runner: { type: 'sidecar' },
  },
];

export function completedJob(jobId: string, analysisId: string) {
  return {
    job_id: jobId,
    analysis_id: analysisId,
    state: 'completed',
    started_at_ms: HARNESS_EPOCH_MS - 184_000,
    finished_at_ms: HARNESS_EPOCH_MS - 181_500,
    progress: 1,
    message: 'Wrote 1 volume and run metadata',
    artifacts: [
      {
        kind: 'volume',
        name: 'smoothed_fwhm6.nii.gz',
        path: '/harness/study/derivatives/smoothed_fwhm6.nii.gz',
        metadata: {},
      },
      {
        kind: 'metadata',
        name: 'run.json',
        path: '/harness/study/derivatives/run.json',
        metadata: {},
      },
    ],
    error: null,
  };
}

const SUBJECTS = ['01', '02', '03'];
const COLUMNS = [
  { session: null, modality: 'anat', suffix: 'T1w', task: null, label: 'T1w' },
  { session: null, modality: 'func', suffix: 'bold', task: 'motor', label: 'bold_task-motor' },
  { session: null, modality: 'func', suffix: 'bold', task: 'rest', label: 'bold_task-rest' },
];

function cell(subject: string, column: (typeof COLUMNS)[number]) {
  const missing = subject === '03' && column.task === 'rest';
  if (missing) return { present: false, run_count: 0, size_bytes: 0, file_paths: [] };
  const runs = column.task === 'motor' ? 2 : 1;
  const file_paths = Array.from({ length: runs }, (_, r) =>
    column.modality === 'anat'
      ? `${BIDS_ROOT}/sub-${subject}/anat/sub-${subject}_T1w.nii.gz`
      : `${BIDS_ROOT}/sub-${subject}/func/sub-${subject}_task-${column.task}_run-${r + 1}_bold.nii.gz`,
  );
  const size = column.modality === 'anat' ? 14_680_064 : 98_566_144;
  return { present: true, run_count: runs, size_bytes: size * runs, file_paths };
}

export const BIDS_SUMMARY = {
  path: BIDS_ROOT,
  name: 'Motor localiser',
  bids_version: '1.9.0',
  license: 'CC0',
  authors: ['B. Harness', 'A. Fixture'],
  subject_count: SUBJECTS.length,
  session_ids: [],
  task_ids: ['motor', 'rest'],
  modalities: ['anat', 'func'],
  total_file_count: 31,
  total_size_bytes: 793_772_032,
  coverage: {
    subjects: SUBJECTS,
    columns: COLUMNS,
    cells: SUBJECTS.map((s) => COLUMNS.map((c) => cell(s, c))),
  },
  participants: [
    { participant_id: 'sub-01', values: { age: '24', sex: 'F', handedness: 'R' } },
    { participant_id: 'sub-02', values: { age: '31', sex: 'M', handedness: 'R' } },
    { participant_id: 'sub-03', values: { age: '27', sex: 'F', handedness: 'L' } },
  ],
  participant_columns: ['age', 'sex', 'handedness'],
  task_designs: [
    {
      task: 'motor',
      trial_types: ['left_hand', 'right_hand', 'rest'],
      avg_duration_secs: 15,
      total_runs: 6,
      events_per_type: { left_hand: 48, right_hand: 48, rest: 36 },
    },
    {
      task: 'rest',
      trial_types: [],
      avg_duration_secs: 480,
      total_runs: 2,
      events_per_type: {},
    },
  ],
  validation: {
    passed: true,
    critical_count: 0,
    warning_count: 1,
    issues: [
      {
        severity: 'warning',
        description: 'sub-03 is missing task-rest; coverage is unbalanced across subjects.',
        file: null,
        rule: 'INCONSISTENT_SUBJECTS',
      },
    ],
  },
  storage_by_modality: { anat: 44_040_192, func: 749_731_840 },
};

export const BIDS_EVENTS = Array.from({ length: 12 }, (_, i) => ({
  onset: i * 15,
  duration: 15,
  trial_type: ['left_hand', 'rest', 'right_hand', 'rest'][i % 4],
  additional: {},
}));
