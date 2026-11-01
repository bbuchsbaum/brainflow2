// Synthetic example dataset shared by all design directions.
// Nothing here is real participant data. Brain thumbnails are derived from the
// MNI152NLin2009cAsym template in test-data/unit.
function mulberry(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const R = mulberry(11);
const pad = n => String(n).padStart(2,'0');

const DS = {
  name: 'Working memory and reward',
  slug: 'wm-reward',
  path: '/Volumes/lab/bids/wm-reward',
  bids: '1.9.0', license: 'CC0', doi: '10.18112/example.v1.2.0',
  authors: ['A. Example', 'B. Placeholder', 'C. Synthetic'],
  scanner: 'Siemens Prisma 3T',
  files: 1071, sizeGB: 182.4, scanSecs: 2.1,
  derivatives: [
    {name:'fmriprep', version:'24.1.1', runs: 431, of: 438},
    {name:'mriqc', version:'24.0.2', runs: 476, of: 476},
    {name:'freesurfer', version:'7.4.1', runs: 40, of: 40},
  ],
};

const N = 40;
const MISSING_S2 = new Set([11,26,31,37,38]);
const subjects = [];
for (let n = 1; n <= N; n++) {
  const patient = R() < 0.46;
  const age = Math.round(patient ? 27 + R()*37 : 19 + R()*26);
  const sex = R() < 0.52 ? 'F' : 'M';
  const hand = R() < 0.9 ? 'R' : 'L';
  let fd = +(0.08 + R()*0.12 + (patient ? 0.04 : 0)).toFixed(2);
  let tsnr = Math.round(52 + R()*16 - (patient ? 3 : 0));
  if (n === 7) fd = 0.61; if (n === 33) fd = 0.48; if (n === 21) fd = 0.37;
  if (n === 14) tsnr = 31;
  const j = R();
  const fd1 = +(fd + (j-0.5)*0.03).toFixed(2);
  let fd2 = MISSING_S2.has(n) ? null : +(fd + (R()-0.5)*0.03 - (n >= 29 ? 0.03 : 0)).toFixed(2);
  if (n === 7) fd2 = 0.64; if (n === 33) fd2 = 0.51;
  subjects.push({ n, id: pad(n), group: patient ? 'patient' : 'control', age, sex, hand, fd, tsnr,
    fdS: {'01': n===33 ? 0.44 : n===7 ? 0.58 : fd1, '02': fd2},
    tsnrS: {'01': tsnr, '02': MISSING_S2.has(n) ? null : (n===14 ? 55 : tsnr + (n >= 29 ? 6 : 0))},
    s2: !MISSING_S2.has(n), upgraded: n >= 29, isNew: n >= 38 });
}

// Series definitions (modal acquisition per series).
const SERIES = {
  T1w:   {dt:'anat', suffix:'T1w', TR:2.4, TE:2.22, vox:'0.8 iso', dims:'208×300×320', label:'T1w'},
  T2w:   {dt:'anat', suffix:'T2w', TR:3.2, TE:563, vox:'0.8 iso', dims:'208×300×320', label:'T2w'},
  nback: {dt:'func', suffix:'bold', task:'nback', TR:0.8, TE:30, MB:6, vox:'2.4 iso', vols:412, PE:'j-', sw:'XA30', label:'nback'},
  mid:   {dt:'func', suffix:'bold', task:'mid',   TR:0.8, TE:30, MB:6, vox:'2.4 iso', vols:520, PE:'j-', sw:'XA30', label:'mid'},
  rest:  {dt:'func', suffix:'bold', task:'rest',  TR:0.8, TE:30, MB:6, vox:'2.4 iso', vols:750, PE:'j-', sw:'XA30', label:'rest'},
  dwi:   {dt:'dwi', suffix:'dwi', TR:3.23, TE:89, vox:'1.5 iso', dirs:98, bvals:'0/1500/3000', label:'dwi'},
  fmap:  {dt:'fmap', suffix:'epi', TR:7.2, TE:66, vox:'2.4 iso', label:'epi AP/PA'},
};

const COLS = [
  {ses:'01', key:'T1w'}, {ses:'01', key:'T2w'},
  {ses:'01', key:'nback', run:1}, {ses:'01', key:'nback', run:2},
  {ses:'01', key:'mid', run:1}, {ses:'01', key:'mid', run:2},
  {ses:'01', key:'rest', run:1},
  {ses:'01', key:'dwi'}, {ses:'01', key:'fmap'},
  {ses:'02', key:'nback', run:1}, {ses:'02', key:'nback', run:2},
  {ses:'02', key:'mid', run:1}, {ses:'02', key:'mid', run:2},
  {ses:'02', key:'rest', run:1}, {ses:'02', key:'fmap'},
].map((c,i) => ({...c, i, dt: SERIES[c.key].dt,
  short: c.run ? `${SERIES[c.key].label} ${c.run}` : (c.key === 'fmap' ? 'fmap' : SERIES[c.key].label)}));

// Acquisition variant groups (CuBIDS-style: same series, different parameters).
const VARIANTS = [
  {id:'A', series:'bold', name:'Modal', diff:'TR 0.8 s · MB 6 · XA30 · j-', note:'Reference acquisition'},
  {id:'B', series:'bold', name:'Scanner upgrade', diff:'TR 1.0 s · MB 4 · XA50', note:'Second sessions acquired after the scanner software upgrade (sub-29 onward; sub-31, 37, 38 have no ses-02). Volumes reduced so run duration is unchanged.', subjects:[29,30,32,33,34,35,36,39,40]},
  {id:'C', series:'bold', name:'Reversed phase encoding', diff:'PE j (modal j-)', note:'sub-12 ses-01, all five functional runs. If the image really is j, fMRIPrep corrects it; check the image matches the metadata and that the field map pair is still opposed.', subjects:[12]},
  {id:'D', series:'T1w', name:'Coarse T1w', diff:'1.0×1.0×1.2 mm (modal 0.8 iso)', note:'sub-23 only. Likely a protocol fallback.', subjects:[23]},
];

// Issues: validator + content checks. Severity: error | warning | info.
const ISSUES = [
  {sev:'error', sub:35, ses:'01', key:'dwi', code:'DWI_MISSING_BVEC', title:'Missing .bvec', detail:'sub-35_ses-01_dwi.nii.gz has a .bval but no .bvec. Tractography and eddy will fail.'},
  {sev:'error', sub:4, ses:'02', key:'fmap', code:'INTENDEDFOR_BROKEN', title:'IntendedFor points to a missing file', detail:'fmap epi dir-AP lists bids::sub-04/ses-02/func/sub-04_ses-02_task-mid_run-2_bold.nii.gz, which does not exist.'},
  {sev:'warning', sub:7, ses:'02', key:'nback', run:2, code:'TRUNCATED_RUN', title:'Truncated run: 287 of 412 volumes', detail:'Run ends at 229.6 s; 21 events fall after the last volume.'},
  {sev:'warning', sub:28, ses:'01', key:'mid', run:1, code:'EVENTS_AFTER_SCAN', title:'3 events after scan end', detail:'Last onset 431.2 s, run duration 416.0 s. Check the events onset reference.'},
  {sev:'warning', sub:16, ses:'01', key:'nback', run:1, code:'SLICE_TIMING_MISSING', title:'SliceTiming missing', detail:'Sidecar has no SliceTiming. Other runs in this series have it.'},
  {sev:'warning', sub:12, ses:'01', key:'nback', code:'PE_REVERSED', title:'Phase encoding j, modal j-', detail:'All five runs in sub-12 ses-01. See variant group C.'},
  {sev:'warning', sub:23, ses:'01', key:'T1w', code:'VOXEL_VARIANT', title:'T1w voxel 1.0×1.0×1.2 mm', detail:'Modal 0.8 mm isotropic. See variant group D.'},
  {sev:'info', sub:9, ses:'01', key:'rest', code:'EXTRA_RUN', title:'Extra rest run', detail:'rest run-2 exists only for sub-09. scans.tsv notes "reacquired: participant asleep".'},
  {sev:'info', sub:null, code:'SIDECAR_UNDOCUMENTED', title:'participants.tsv column "hand" undocumented', detail:'Add a description and levels to participants.json.'},
];
const QC_OUTLIERS = [
  {sub:7, metric:'fd_mean', value:'0.61 mm', note:'nback, both sessions'},
  {sub:33, metric:'fd_mean', value:'0.48 mm', note:'all func'},
  {sub:14, metric:'tsnr', value:'31', note:'ses-01 func, ventromedial dropout'},
  {sub:5, metric:'gsr_y', value:'0.21', note:'nback run-1 ghosting'},
];

function cellOf(s, c) {
  const n = s.n;
  if (c.ses === '02' && !s.s2) return {state:'missing'};
  if (n === 22 && c.ses === '01' && c.key === 'T2w') return {state:'missing'};
  if (n === 34 && c.ses === '02' && c.key === 'mid' && c.run === 2) return {state:'missing'};
  const out = {state:'ok', qc:false, variant:'A'};
  const iss = ISSUES.find(i => i.sub === n && i.ses === c.ses && i.key === c.key && (i.run == null || i.run === c.run));
  if (SERIES[c.key].dt === 'func') {
    if (c.ses === '02' && s.upgraded) { out.state = 'variant'; out.variant = 'B'; }
    if (n === 12 && c.ses === '01') { out.state = 'variant'; out.variant = 'C'; }
    if ((n === 7 && c.key === 'nback') || n === 33 || (n === 14 && c.ses === '01') || (n === 5 && c.key === 'nback' && c.run === 1 && c.ses === '01')) out.qc = true;
  }
  if (n === 23 && c.key === 'T1w') { out.state = 'variant'; out.variant = 'D'; }
  if (iss && iss.sev !== 'info' && out.state !== 'variant') out.state = iss.sev === 'error' ? 'error' : 'warning';
  if (iss) out.issue = iss;
  if (n === 9 && c.key === 'rest' && c.ses === '01') out.extra = true;
  return out;
}
const CELLS = subjects.map(s => COLS.map(c => cellOf(s, c)));
const colCount = c => CELLS.reduce((a, row) => a + (row[c.i].state !== 'missing' ? 1 : 0), 0);

// Events: canonical designs.
function nbackEvents() {
  const ev = []; let t = 12;
  const order = ['0back','2back','0back','2back','2back','0back','2back','0back'];
  for (const b of order) { ev.push({onset:t, dur:30, type:b}); t += 30; ev.push({onset:t, dur:10, type:'fixation'}); t += 10; }
  return ev; // ends ~332
}
function midEvents() {
  const r = mulberry(5); const ev = []; let t = 8;
  while (t < 404) { const u = r(); ev.push({onset:t, dur:2, type: u < 0.4 ? 'gain' : u < 0.8 ? 'loss' : 'neutral'}); t += 4 + Math.round(r()*3); }
  return ev;
}
const TASKS = {
  nback: {dur: 329.6, trials: 128, types:['0back','2back','fixation'], events: nbackEvents(), order:'Identical block order in all 156 runs'},
  mid:   {dur: 416.0, trials: 72, types:['gain','loss','neutral'], events: midEvents(), order:'4 counterbalanced orders'},
  rest:  {dur: 600.0, trials: 0, types:[], events: [], order:'No events'},
};
const EVCOLOR = {'0back':'#93b4d6','2back':'#c9b48f','fixation':'#5d6067','gain':'#93c9b0','loss':'#d9a0a6','neutral':'#8c8f96'};

// Synthetic FD trace for a run (mm) with spikes.
function fdTrace(n, len, base, spikes) {
  const r = mulberry(n); const a = [];
  for (let i = 0; i < len; i++) a.push(Math.max(0, base*0.6 + r()*base*0.8 + (spikes.includes(i) ? 0.9 + r()*0.8 : 0)));
  return a;
}

// ── Round 2: single derived model. Every count on screen comes from here. ──
const FD_THR = 0.25; // mean FD exclusion threshold, mm (editable; Parkes et al. 2018 stringent criterion)
const M = (() => {
  const m = {};
  m.ctrl = subjects.filter(s=>s.group==='control').length; m.pat = N - m.ctrl;
  const ages = subjects.map(s=>s.age).sort((a,b)=>a-b);
  m.ageMin = ages[0]; m.ageMax = ages[N-1]; m.ageMed = ages[Math.floor(N/2)];
  m.noS2 = subjects.filter(s=>!s.s2).length;
  m.runsByVariant = {}; m.subsByVariant = {};
  let bold = 0;
  subjects.forEach((s,si) => COLS.forEach(c => { const cell = CELLS[si][c.i]; if (cell.state==='missing') return;
    if (SERIES[c.key].dt==='func' || c.key==='T1w') { const v = (c.key==='T1w' ? 'T1w:' : 'bold:') + cell.variant;
      m.runsByVariant[v] = (m.runsByVariant[v]||0) + 1; (m.subsByVariant[v] = m.subsByVariant[v] || new Set()).add(s.n); }
    if (SERIES[c.key].dt==='func') bold++; }));
  m.bold = bold;
  m.nbackRuns = subjects.reduce((a,s,si)=>a+COLS.filter(c=>c.key==='nback'&&CELLS[si][c.i].state!=='missing').length,0);
  m.errors = ISSUES.filter(i=>i.sev==='error'); m.warnings = ISSUES.filter(i=>i.sev==='warning' && !['PE_REVERSED','VOXEL_VARIANT'].includes(i.code));
  m.infos = ISSUES.filter(i=>i.sev==='info');
  m.qc = [];
  subjects.forEach(s => ['01','02'].forEach(ses => { const v = s.fdS[ses]; if (v!=null && v > FD_THR) m.qc.push({sub:s.n, ses, metric:'FD', v}); }));
  subjects.forEach(s => ['01','02'].forEach(ses => { const v = s.tsnrS[ses]; if (v!=null && v < 40) m.qc.push({sub:s.n, ses, metric:'tSNR', v}); }));
  m.qcSubs = new Set(m.qc.filter(q=>q.metric==='FD').map(q=>q.sub));
  m.variants = VARIANTS.filter(v=>v.id!=='A');
  m.newSubs = subjects.filter(s=>s.isNew);
  m.findings = m.errors.length + m.warnings.length + m.variants.length + m.qc.length + m.infos.length;
  return m;
})();
const vRuns = (series, id) => M.runsByVariant[`${series}:${id}`] || 0;
const vSubs = (series, id) => [...(M.subsByVariant[`${series}:${id}`] || [])];
// fMRIPrep: run on dataset v1.1.0 (37 participants). sub-38..40 added in v1.2.0 are unprocessed.
const derivOf = s => ({ fmriprep: s.isNew ? 'missing' : s.n===7 ? 'partial' : 'ok', mriqc: 'ok', freesurfer: s.isNew ? 'missing' : 'ok' });
const EXCLUSIONS = [
  {entity:'sub-07 ses-02 task-nback run-2', reason:'Truncated run (287/412 vols); mean FD 0.64 mm', by:'bb', date:'2026-10-30'},
];

// ── Round 3: per-run QC. Session values are summaries of runs, never the reverse. ──
const FUNC_COLS = COLS.filter(c => SERIES[c.key].dt === 'func');
const RUNQC = {};
subjects.forEach(s => FUNC_COLS.forEach(c => {
  if (CELLS[s.n-1][c.i].state === 'missing') return;
  const r = mulberry(s.n*97 + c.i*13), base = s.fdS[c.ses];
  let fd = Math.max(0.04, +(base + (r()-0.5)*0.09).toFixed(2));
  let tsnr = Math.round((s.tsnrS[c.ses] ?? s.tsnr) + (r()-0.5)*7);
  if (s.n === 14 && c.ses === '01') tsnr = 29 + Math.round(r()*4);
  RUNQC[`${s.n}:${c.i}`] = {fd, tsnr, ghost: (s.n===5 && c.ses==='01' && c.key==='nback' && c.run===1) ? 0.21 : +(0.03 + r()*0.05).toFixed(2)};
}));
// Selected run: the FD number is the mean of the trace that is drawn.
const SEL_TRACE = fdTrace(33, 330, 0.47, [61,62,148,149,201,264]);
const SEL_FD = +(SEL_TRACE.reduce((a,b)=>a+b,0)/SEL_TRACE.length).toFixed(2);
const SEL_OVER = SEL_TRACE.filter(v => v > 0.5).length;
RUNQC[`33:${COLS.findIndex(c=>c.ses==='02'&&c.key==='nback'&&c.run===1)}`].fd = SEL_FD;
const runQC = (n, ci) => RUNQC[`${n}:${ci}`];
const sesMeanFD = (n, ses) => { const v = FUNC_COLS.filter(c=>c.ses===ses).map(c=>runQC(n,c.i)).filter(Boolean).map(q=>q.fd); return v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : null; };
const QC3 = (() => {
  const items = [];
  subjects.forEach(s => ['01','02'].forEach(ses => {
    const runs = FUNC_COLS.filter(c=>c.ses===ses).map(c=>({c, q:runQC(s.n,c.i)})).filter(x=>x.q);
    const over = runs.filter(x => x.q.fd > FD_THR);
    if (over.length) items.push({kind:'FD', sub:s.n, ses, n:over.length, of:runs.length, max:Math.max(...over.map(x=>x.q.fd))});
    const low = runs.filter(x => x.q.tsnr < 40);
    if (low.length) items.push({kind:'tSNR', sub:s.n, ses, n:low.length, of:runs.length, min:Math.min(...low.map(x=>x.q.tsnr))});
    const gh = runs.filter(x => x.q.ghost > 0.15);
    if (gh.length) items.push({kind:'ghost', sub:s.n, ses, n:gh.length, of:runs.length, max:gh[0].q.ghost});
  }));
  return items;
})();
M.qcRuns = QC3.reduce((a,q)=>a+q.n,0);
M.qcSubs3 = new Set(QC3.filter(q=>q.kind==='FD').map(q=>q.sub));
M.findings3 = M.errors.length + M.warnings.length + M.variants.length + QC3.length + M.infos.length;
