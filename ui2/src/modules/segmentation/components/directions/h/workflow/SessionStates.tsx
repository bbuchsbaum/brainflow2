/**
 * Round 5: the session's edges in direction H.
 *
 * - `save`: save and export as a side sheet (over the orthogonal column and
 *   the Inspector; the primary keeps its view): the label volume (NIfTI-1,
 *   intent 1002, the reference grid's sform and qform), the label tables
 *   (BIDS dseg.tsv, ITK-SNAP, FreeSurfer LUT) with a preview, the provenance
 *   sidecar and the per-voxel provenance volume, the destination and the
 *   exact files written.
 * - `resume`: reopening after a crash. The view is restored exactly (slice,
 *   label, zoom, contrast, tool), a banner above the image (never over it)
 *   names what was recovered from the journal and offers the choice, and the
 *   last edit is outlined with the brush's neutral outline and marked "last"
 *   on the ruler.
 * - `setup`: starting a session as a side sheet: the reference grid, the
 *   label table (a protocol pack or an imported table) and a new label with
 *   a colour picker that only offers distinguishable colours.
 */

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ChevronRight, FolderOpen, History, Plus } from 'lucide-react';
import { Button, Checkbox, SegmentedControl, Select, TextField } from '@/components/ui/bf';
import { StatusItem, Swatch } from '@/modules/segmentation/components/shared/chrome';
import { fmtInt, fmtMm, worldToDisplay } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_DEFS, NATIVE, NATIVE_GEOMETRY, NATIVE_SLICES_J, PROTOCOL, labelTint, yOfJ } from '@/modules/segmentation/components/shared/mockData';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { primaryView, zoomFactor } from '@/modules/segmentation/components/shared/views';
import { MUTED_MIN_DELTA_E } from '@/modules/segmentation/components/shared/colour';
import { RESERVED_MIN_DELTA_E } from '@/modules/segmentation/components/shared/workflowRules';
import type { Projector } from '@/modules/segmentation/components/shared/SliceView';
import {
  BrushStrip,
  GeometryTitle,
  HShell,
  InspectorFrame,
  LabelsSection,
  NeighbourKey,
  SessionHeader,
  Sep,
  SliceRuler,
  StepCard,
  StepNext,
  TextToggle,
  ToolRail,
} from '@/modules/segmentation/components/directions/h/DirectionH';
import { ISLANDS_HERE, SLICE_K, hOrtho, hPrimary, sliceDir, islandOverlay, neighbourOverlay, strokeLabels } from '@/modules/segmentation/components/directions/h/hViews';
import { ChoiceRow, FilePreview, OrthoColumn, PrimaryPanel, SheetPart, SideSheet, StateChip, TraceGrid } from './parts';
import { CANDIDATES, JOURNAL, LAST_STROKE, NEW_LABEL_DEF, SAVE } from './workflowData';
import { RECOVERY } from '@/modules/segmentation/components/shared/session';

function TraceStatus({ extra }: { extra?: React.ReactNode }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      <StatusItem label="Label" value="CA1" mono={false} />
      {extra}
    </>
  );
}

function ZoomContrasts({ fovMm }: { fovMm: number }) {
  return (
    <>
      <span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(fovMm)}</span>
      <TextToggle pressed={false} title="Linked contrasts (C)">
        Contrasts
      </TextToggle>
    </>
  );
}

/** The session as it stands, no stroke in progress (the brush is not over the view). */
function restingView() {
  const base = hPrimary('tracing');
  const labels = OVERLAYS.withStroke(SCENE.tracing.base, SCENE.tracing.wet);
  return { ...base, brush: null, overlays: [neighbourOverlay(labels), ...strokeLabels(OVERLAYS.labels(labels, CA1)), islandOverlay(labels)] };
}

// ------------------------------------------------------------------- save

/**
 * ⌘S writes the default bundle silently to the remembered path (the header
 * then says "Saved"); this sheet is "Save as / export…", for another place,
 * other table dialects or a look at what is written.
 */
const FILES = [
  { name: `${SAVE.base}_dseg.nii.gz`, what: 'label volume' },
  { name: `${SAVE.base}_dseg.tsv`, what: 'label table' },
  { name: `${SAVE.base}_dseg.json`, what: 'sidecar' },
  { name: `${SAVE.base}_provenance.nii.gz`, what: 'per-voxel provenance' },
];

const SIDECAR = [
  `"Rater": "Rater A", "ProtocolPack": "${PROTOCOL.version}", "Status": "${SAVE.check.status}",`,
  '"SpatialReference": "sub-01/ses-01/anat/sub-01_ses-01_T2w.nii.gz", "sha256": "9f3c…e21a",',
  `"TimeOnTask": { "total": "${SAVE.timeOnTask.total}", "navigation": "${SAVE.timeOnTask.navigation}",`,
  `  "drawing": "${SAVE.timeOnTask.drawing}", "correction": "${SAVE.timeOnTask.correction}" },`,
  `"History": { "steps": ${JOURNAL.step}, "branches": 1 },`,
  `"Provenance": { ${SAVE.provenanceCodes.map((c) => `"${c.code}": "${c.name}"`).join(', ')} },`,
  `"AI": { "provider": "nnInteractive v2.5.0", "weights_licence": "CC BY-NC-SA 4.0", "acknowledged_by": "Rater A" },`,
  '"Software": "Brainflow 0.9.0, segmentation (experimental)"',
];

/** One collapsed line of a sheet: number, title, the summary, a chevron. */
function SummaryPart({ n, title, summary, testId, children }: { n: number; title: string; summary: React.ReactNode; testId: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-bf-border-subtle" data-testid={testId}>
      <summary className="flex h-8 cursor-pointer select-none list-none items-center gap-2 px-3 text-bf-xs hover:bg-bf-bg-hover [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-bf-2xs text-bf-text-muted">{n}</span>
        <span className="w-[84px] shrink-0 font-semibold text-bf-text-primary">{title}</span>
        <span className="min-w-0 flex-1 truncate text-bf-text-secondary" data-summary>
          {summary}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-bf-text-muted group-open:rotate-90" aria-hidden />
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-2.5 pl-[30px]">{children}</div>
    </details>
  );
}

function SaveSheet() {
  const unreviewed = SAVE.unreviewed;
  const ai = unreviewed.filter((u) => u.prov === 'ai-unreviewed').map((u) => u.k);
  const interp = unreviewed.filter((u) => u.prov === 'interp-unreviewed').map((u) => u.k);
  return (
    <SideSheet
      title="Save as / export…"
      meta={`⌘S saves to the same place · ${SAVE.stepsUnsaved} steps since ${JOURNAL.lastSave.time}`}
      testId="save-sheet"
      footer={
        <>
          <Button variant="primary" title="Write the files below, each through a temporary file and a rename" data-testid="save-button">
            Save
          </Button>
          <Button variant="ghost">Cancel</Button>
          <span className="ml-auto text-bf-2xs text-bf-text-muted">
            {FILES.length} files · status {SAVE.check.status} · replaces nothing
          </span>
        </>
      }
    >
      {SAVE.check.warn ? (
        <div className="flex items-start gap-2 border-b border-bf-border-subtle px-3 py-2 text-bf-xs" data-testid="save-warning" role="status">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-bf-warning" aria-hidden />
          <span className="text-bf-text-secondary">
            <span className="text-bf-text-primary">Saved as a draft: {SAVE.check.warn}</span> (AI k {ai.join(', ')}; interpolated k {interp.join('–')}).
            Saving is fine; Mark CA1 complete waits until they are reviewed.
          </span>
        </div>
      ) : null}
      <SummaryPart
        n={1}
        title="Label volume"
        testId="save-volume"
        summary={
          <>
            NIfTI-1 gz · <span className="font-mono">{SAVE.header.datatype}</span> · labels · on the T2w grid · {fmtInt(SAVE.labelVoxels)} vx
          </>
        }
      >
        <dl className="m-0 grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-bf-xs" data-testid="nifti-header">
          <dt className="text-bf-text-muted">intent</dt>
          <dd className="m-0 text-bf-text-primary">
            <span className="font-mono">{SAVE.header.intentCode}</span> <span className="text-bf-text-secondary">NIFTI_INTENT_LABEL</span>
          </dd>
          <dt className="text-bf-text-muted">grid</dt>
          <dd className="m-0 text-bf-text-secondary">
            T2w native <span className="font-mono">{NATIVE_GEOMETRY}</span> · voxel for voxel · sform + qform kept
          </dd>
          <dt className="text-bf-text-muted">labels</dt>
          <dd className="m-0 text-bf-text-secondary">
            {LABEL_DEFS.length} labels · {fmtInt(SAVE.labelVoxels)} vx · {fmtInt(SAVE.labelVoxels * SAVE.voxelMm3)} mm³
          </dd>
        </dl>
      </SummaryPart>
      <SummaryPart n={2} title="Label table" testId="save-tables" summary="BIDS dseg.tsv, with a parent column">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bf-xs">
          <Checkbox defaultChecked>BIDS dseg.tsv</Checkbox>
          <Checkbox>ITK-SNAP labels</Checkbox>
          <Checkbox title="Exported with FreeSurferColorLUT ids by name (CA1 206, subiculum 205, fimbria 212); a colliding id is never reused silently">FreeSurfer LUT</Checkbox>
        </div>
        <FilePreview lines={SAVE.tables.dseg} max={3} testId="table-preview" />
      </SummaryPart>
      <SummaryPart n={3} title="Provenance" testId="save-provenance" summary="sidecar and per-voxel provenance volume">
        <div className="grid grid-cols-[14px_minmax(0,1fr)_64px] gap-x-2 font-mono text-bf-2xs text-bf-text-secondary" data-testid="provenance-codes">
          {SAVE.provenanceCodes.map((c) => (
            <React.Fragment key={c.code}>
              <span className="text-right text-bf-text-muted">{c.code}</span>
              <span className="font-sans">{c.name}</span>
              <span className="text-right tabular-nums">{fmtInt(c.vx)} vx</span>
            </React.Fragment>
          ))}
        </div>
      </SummaryPart>
      <section className="flex flex-col gap-1.5 border-b border-bf-border-subtle px-3 py-2" data-testid="save-recorded">
        <p className="m-0 text-bf-xs leading-snug text-bf-text-secondary" data-testid="save-sentence">
          Recorded with the labels: you as rater, the pack version, the T2w it was traced on, time on task, the history and how every
          voxel got its label ({SAVE.provenanceCodes.filter((c) => c.vx > 0).length} kinds, AI and interpolated slices marked reviewed or not).
        </p>
        <details className="text-bf-2xs text-bf-text-muted" data-testid="save-record">
          <summary className="cursor-pointer select-none text-bf-text-secondary">Show record</summary>
          <div className="mt-1">
            <FilePreview lines={SIDECAR} max={8} testId="sidecar-preview" />
          </div>
        </details>
      </section>
      <SheetPart n={4} title="Destination" meta="BIDS derivatives · remembered for ⌘S" testId="save-destination">
        <div className="flex items-center gap-1.5">
          <TextField aria-label="Folder" defaultValue={SAVE.folder} className="min-w-0 flex-1 font-mono" />
          <Button variant="secondary" size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />}>
            Choose…
          </Button>
        </div>
        <ul className="m-0 flex list-none flex-col p-0 font-mono text-bf-2xs leading-4 text-bf-text-secondary" data-testid="save-files">
          {FILES.map((f) => (
            <li key={f.name} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 font-sans text-bf-text-muted">{f.what}</span>
            </li>
          ))}
        </ul>
      </SheetPart>
    </SideSheet>
  );
}

export function SaveState() {
  const view = restingView();
  return (
    <HShell testState="save" status={<TraceStatus extra={<StatusItem label="Save" value={`${SAVE.stepsUnsaved} steps unsaved`} mono={false} />} />} rail={<ToolRail state="tracing" />} inspector={<SaveSheet />}>
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={<GeometryTitle image={view.image} />}
            right={<ZoomContrasts fovMm={view.fovMm} />}
            line2={
              <>
                <BrushStrip />
                <span className="ml-auto">
                  <NeighbourKey island={ISLANDS_HERE > 0} />
                </span>
              </>
            }
            view={view}
            ruler={<SliceRuler state="tracing" />}
          />
        }
      />
    </HShell>
  );
}

// ----------------------------------------------------------------- resume

const RECOVERED_STEPS = RECOVERY.steps;

/** The banner above the image: what was recovered, what was restored, and the choice. */
function RecoveredBanner() {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-bf-border-subtle bg-bf-bg-panel px-3 py-2" role="status" data-testid="recovered-banner">
      <div className="flex items-start gap-2 text-bf-xs">
        <History className="mt-px h-3.5 w-3.5 shrink-0 text-bf-text-secondary" aria-hidden />
        <span className="text-bf-text-secondary">
          <span className="text-bf-text-primary">Recovered {RECOVERED_STEPS} steps from the journal.</span> Brainflow closed unexpectedly at {RECOVERY.crashedAt}; the
          last save was {RECOVERY.lastSave.time} (step {RECOVERY.lastSave.step}). Nothing was lost after step {RECOVERY.head}.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] font-mono text-bf-2xs text-bf-text-muted" data-testid="restored-view">
        <span className="font-sans text-bf-text-secondary">Restored</span>
        k {SLICE_K} <Sep /> CA1 <Sep /> brush ⌀ 3.0 mm <Sep /> 4.0× <Sep /> T2w window 12–230 <Sep /> step 6/9 <Sep /> last edit {RECOVERY.lastEdit}
      </div>
      <div className="flex items-center gap-1.5 pl-[22px]">
        <Button variant="primary" size="sm" title="Keep the recovered steps and carry on (Enter); saving stays your choice">
          Keep recovered work
        </Button>
        <Button variant="ghost" size="sm" title="Discard the recovered steps and open the 14:02 save; the journal is kept until you save">
          Open the 14:02 save
        </Button>
        <Button variant="ghost" size="sm" title="Show what the recovered steps changed, step by step">
          Show changes
        </Button>
      </div>
    </div>
  );
}

/** "last edit" beside the outlined last stroke, outside it. */
function LastEditTag({ p }: { p: Projector }) {
  const vs = LAST_STROKE;
  const xs = vs.map((v) => v[0]);
  const ys = vs.map((v) => v[1]);
  // Left of the stroke, at its lower end: beside the structure, not over the labels.
  const at = p.project([Math.min(...xs) - 0.5, Math.max(...ys) + 0.5]);
  return (
    <span
      className="pointer-events-none absolute -translate-x-full whitespace-nowrap pr-1 text-bf-2xs leading-4 text-bf-text-primary [text-shadow:0_0_2px_var(--bf-bg-canvas),0_0_3px_var(--bf-bg-canvas),0_0_4px_var(--bf-bg-canvas)]"
      style={{ left: at.x, top: at.y + 4 }}
      data-testid="last-edit-tag"
    >
      last edit · {RECOVERY.lastEdit.slice(0, 5)}
    </span>
  );
}

export function ResumeState() {
  const rest = restingView();
  const view = {
    ...rest,
    overlays: [...(rest.overlays ?? []), { kind: 'voxels' as const, voxels: LAST_STROKE, color: 'var(--bf-text-primary)', outline: true, width: 1.25 }],
  };
  return (
    <HShell
      testState="resume"
      status={<TraceStatus extra={<StatusItem label="Journal" value={`recovered ${RECOVERED_STEPS} steps`} mono={false} />} />}
      rail={<ToolRail state="tracing" />}
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" status="recovered · not saved" />
          <StepCard state="tracing" />
          <StepNext state="tracing" />
          <LabelsSection state="tracing" hover={null} />
        </InspectorFrame>
      }
    >
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={<GeometryTitle image={view.image} />}
            right={<ZoomContrasts fovMm={view.fovMm} />}
            line2={
              <>
                <BrushStrip />
                <span className="ml-auto">
                  <NeighbourKey island={ISLANDS_HERE > 0} />
                </span>
              </>
            }
            banner={<RecoveredBanner />}
            view={view}
            overlay={(p) => <LastEditTag p={p} />}
            ruler={<SliceRuler state="tracing" marks={{ [SLICE_K]: { mark: 'solid', note: 'last', title: `k ${SLICE_K} · last edit ${RECOVERY.lastEdit}` } }} />}
          />
        }
        side={<OrthoColumn />}
      />
    </HShell>
  );
}

// ------------------------------------------------------------------ setup

/** The colour picker: only the offered colours; the refused ones (crossed, with the reason) behind one line. */
function ColourPicker() {
  const ok = CANDIDATES.filter((c) => c.ok);
  const refused = CANDIDATES.filter((c) => !c.ok);
  const swatch = (c: (typeof CANDIDATES)[number]) => {
    const selected = c.color === NEW_LABEL_DEF.color;
    return (
      <button
        key={c.color}
        type="button"
        disabled={!c.ok}
        aria-pressed={selected}
        aria-label={c.ok ? `Colour ${c.color}` : `Colour ${c.color}: ${c.reason}`}
        title={c.ok ? c.color : `Not offered: ${c.reason}`}
        className={clsx('relative h-5 w-full rounded-[2px] p-0', selected && 'outline outline-2 outline-offset-1 outline-bf-text-primary', !c.ok && 'cursor-not-allowed opacity-35')}
        style={{ background: c.color }}
        data-candidate={c.ok ? 'ok' : 'refused'}
      >
        {!c.ok ? (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden>
            <line x1={0} y1={10} x2={10} y2={0} className="stroke-bf-bg-canvas" strokeWidth={1.2} />
          </svg>
        ) : null}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-1" data-testid="colour-picker">
      <div className="grid grid-cols-11 gap-1">{ok.map(swatch)}</div>
      <details className="text-bf-2xs text-bf-text-muted" data-testid="colour-hidden">
        <summary className="cursor-pointer select-none">
          {refused.length} hidden: too close to existing labels, the crosshair or the warning colour
        </summary>
        <div className="mt-1 grid grid-cols-11 gap-1">{refused.map(swatch)}</div>
        <span>
          Offered only when its tints differ from every label's by ΔE ≥ {MUTED_MIN_DELTA_E} and from the crosshair and warning by ≥ {RESERVED_MIN_DELTA_E}.
        </span>
      </details>
    </div>
  );
}

/** How the new label will draw: active, inactive and quiet strokes on mid-grey. */
function StrokePreview() {
  return (
    <span className="flex items-center gap-2 text-bf-2xs text-bf-text-muted" data-testid="stroke-preview">
      {(['active', 'inactive', 'quiet'] as const).map((lv) => (
        <span key={lv} className="flex items-center gap-1">
          <svg width={34} height={14} aria-hidden>
            <rect width={34} height={14} className="fill-bf-text-muted" fillOpacity={0.45} />
            <line x1={3} x2={31} y1={7} y2={7} className="stroke-bf-bg-canvas" strokeWidth={lv === 'active' ? 3.5 : 2.5} strokeOpacity={0.6} />
            <line x1={3} x2={31} y1={7} y2={7} style={{ stroke: labelTint(NEW_LABEL_DEF.id, lv) }} strokeWidth={lv === 'active' ? 1.5 : 1} />
          </svg>
          {lv}
        </span>
      ))}
    </span>
  );
}

/** A labelled field in a compact grid. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-bf-2xs text-bf-text-muted">{label}{children}</label>;
}

/**
 * Where the native slab sits: a small sagittal T2w with the 20 slices as a
 * band tilted 30° and k 1 / k 20 at its ends (the consequence of the grid
 * choice, drawn rather than described).
 */
function SlabLocator() {
  const o = hOrtho('tracing').sagittal;
  const dir = sliceDir('sagittal');
  const [x0, , z0] = CROSSHAIR_WORLD;
  const at = (y: number) => worldToDisplay('sagittal', [x0, y, z0]);
  const ys = NATIVE_SLICES_J.map(yOfJ);
  const mid = at((Math.min(...ys) + Math.max(...ys)) / 2);
  const span = (Math.max(...ys) - Math.min(...ys)) * Math.cos((NATIVE.tiltDeg.sagittal * Math.PI) / 180) + NATIVE.spacing[2];
  return (
    <div className="relative h-[96px] w-[128px] shrink-0 overflow-hidden rounded-sm border border-bf-border-subtle" data-testid="slab-locator" title="The 20 native slices (k 1 posterior to k 20 anterior) on a sagittal T2w, tilted 30° from the world axes">
      <SliceView
        image={o.image}
        center={mid}
        fovMm={84}
        crosshair={null}
        letters={false}
        overlays={[
          { kind: 'band', through: mid, dir, widthMm: span, lengthMm: 14, ticks: false },
          ...[Math.min(...ys), Math.max(...ys)].map((y) => {
            const p0 = at(y);
            const d = `M${p0[0] - dir[0] * 14} ${p0[1] - dir[1] * 14}L${p0[0] + dir[0] * 14} ${p0[1] + dir[1] * 14}`;
            return { kind: 'path' as const, d, className: 'stroke-bf-text-primary', width: 1, opacity: 0.9 };
          }),
        ]}
        aria-label="Native slab on a sagittal T2w"
      />
      <span className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-bf-2xs text-bf-text-primary [text-shadow:0_0_3px_var(--bf-bg-canvas)]">k 20</span>
      <span className="pointer-events-none absolute bottom-0.5 right-1 font-mono text-bf-2xs text-bf-text-primary [text-shadow:0_0_3px_var(--bf-bg-canvas)]">k 1</span>
    </div>
  );
}

/** T1w over T2w as a checkerboard at the hippocampus, so a misregistration shows as broken edges. */
function Checkerboard() {
  const props = { center: SCENE.hippoCentre, fovMm: 56, crosshair: null, letters: false } as const;
  return (
    <div className="relative h-[120px] w-[120px] shrink-0 overflow-hidden rounded-sm border border-bf-border-subtle" data-testid="registration-check">
      <SliceView image={DESIGN.images.corT2} {...props} aria-label="T2w under the checkerboard" />
      <div
        className="absolute inset-0"
        style={{
          WebkitMaskImage: 'conic-gradient(black 25%, transparent 0 50%, black 0 75%, transparent 0)',
          maskImage: 'conic-gradient(black 25%, transparent 0 50%, black 0 75%, transparent 0)',
          WebkitMaskSize: '60px 60px',
          maskSize: '60px 60px',
        }}
        data-testid="checkerboard-t1"
      >
        <SliceView image={DESIGN.images.corT1} {...props} aria-label="T1w in the checkerboard squares" />
      </div>
    </div>
  );
}

function SetupSheet() {
  return (
    <SideSheet
      title="New segmentation"
      meta="on the image open in Trace"
      testId="setup-sheet"
      footer={
        <>
          <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} title="Create the session and start step 1 of the pack" data-testid="setup-start">
            Start tracing
          </Button>
          <Button variant="ghost">Cancel</Button>
          <span className="ml-auto text-bf-2xs text-bf-text-muted">grid and table are fixed once tracing starts</span>
        </>
      }
    >
      <SheetPart n={1} title="Subject and rater" meta="names the files; blinding hides other raters" testId="setup-identity">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px_minmax(0,1fr)] gap-2">
          <Field label="Subject">
            <TextField aria-label="Subject" defaultValue="sub-01" className="font-mono" />
          </Field>
          <Field label="Session">
            <TextField aria-label="Session" defaultValue="ses-01" className="font-mono" />
          </Field>
          <Field label="Hemisphere">
            <SegmentedControl aria-label="Hemisphere" size="sm" value="L" onValueChange={() => undefined} options={[{ value: 'L', label: 'L' }, { value: 'R', label: 'R' }]} />
          </Field>
          <Field label="Rater">
            <TextField aria-label="Rater" defaultValue="Rater A" />
          </Field>
        </div>
        <Checkbox defaultChecked data-testid="setup-blinding">
          Blind: hide other raters' labels of this subject until I submit
        </Checkbox>
      </SheetPart>
      <SheetPart n={2} title="Reference grid" meta="labels are stored here, voxel for voxel" testId="setup-grid">
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <ChoiceRow
              selected
              title={
                <span>
                  T2w · native oblique <span className="font-mono text-bf-text-secondary">{NATIVE_GEOMETRY}</span>
                </span>
              }
              detail="20 slices ⊥ the long axis. The pack traces here."
              testId="grid-t2"
            />
            <ChoiceRow
              selected={false}
              title={
                <span>
                  T1w · <span className="font-mono text-bf-text-secondary">1.0 mm isotropic</span>
                </span>
              }
              detail="Coarser than the pack's T2w rules need."
            />
          </div>
          <SlabLocator />
        </div>
      </SheetPart>
      <SheetPart n={3} title="T1w on the T2w grid" meta="checked before tracing" testId="setup-registration">
        <div className="flex gap-2.5">
          <Checkerboard />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-bf-xs text-bf-text-secondary">
            <span>
              Rigid transform <span className="font-mono text-bf-2xs text-bf-text-muted">sub-01_ses-01_from-T1w_to-T2w_xfm.mat</span>
            </span>
            <span className="text-bf-2xs text-bf-text-muted">
              Checkerboard of T1w and T2w at the hippocampus: edges should run straight across the squares.
            </span>
            <SegmentedControl
              aria-label="Registration view"
              size="sm"
              value="checker"
              onValueChange={() => undefined}
              options={[
                { value: 'checker', label: 'Checkerboard' },
                { value: 'edges', label: 'T1w edges' },
                { value: 'flicker', label: 'Flicker' },
              ]}
            />
            <Checkbox defaultChecked data-testid="registration-aligned">
              Aligned at the hippocampus
            </Checkbox>
          </div>
        </div>
      </SheetPart>
      <SheetPart n={4} title="Label table" testId="setup-table">
        <div className="flex items-center gap-2">
          <SegmentedControl
            aria-label="Label table source"
            size="sm"
            value="pack"
            onValueChange={() => undefined}
            options={[
              { value: 'pack', label: 'Protocol pack' },
              { value: 'import', label: 'Import a table' },
              { value: 'empty', label: 'Empty' },
            ]}
          />
          <Select
            aria-label="Protocol pack"
            defaultValue="hip"
            className="min-w-0 flex-1"
            options={[
              { value: 'hip', label: `${PROTOCOL.name} · ${PROTOCOL.version}` },
              { value: 'wmh', label: 'White-matter lesions · example pack v0.1 · 1 label' },
            ]}
          />
        </div>
        <div className="grid grid-cols-[14px_20px_minmax(0,1fr)_96px] items-center gap-x-2 text-bf-xs text-bf-text-secondary" data-testid="setup-labels">
          {LABEL_DEFS.map((d) => (
            <React.Fragment key={d.id}>
              <Swatch color={d.color} size={9} />
              <span className="font-mono text-bf-2xs text-bf-text-muted">{d.id}</span>
              <span className="truncate">{d.long}</span>
              <span className="truncate text-bf-2xs text-bf-text-muted">Hippocampus</span>
            </React.Fragment>
          ))}
        </div>
        <details className="group" data-testid="setup-new-label">
          <summary className="flex h-6 cursor-pointer select-none list-none items-center gap-1.5 text-bf-xs text-bf-text-secondary hover:text-bf-text-primary [&::-webkit-details-marker]:hidden">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add label
            <span className="text-bf-2xs text-bf-text-muted">to this session, not to the pack</span>
          </summary>
          <div className="flex flex-col gap-2 pt-1">
            <div className="grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] gap-2">
              <Field label="Name">
                <TextField aria-label="Name" defaultValue={NEW_LABEL_DEF.name} />
              </Field>
              <Field label="Id">
                <TextField aria-label="Id" defaultValue={String(NEW_LABEL_DEF.id)} className="font-mono" title="Next free id; ids 1–6 are the pack's" />
              </Field>
              <Field label="Parent">
                <Select aria-label="Parent" defaultValue="hip" options={[{ value: 'hip', label: 'Hippocampus' }, { value: 'none', label: 'None (top level)' }]} />
              </Field>
            </div>
            <ColourPicker />
            <div className="flex items-center gap-2">
              <StrokePreview />
              <Button variant="secondary" size="sm" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />}>
                Add label
              </Button>
            </div>
          </div>
        </details>
        <span className="text-bf-2xs text-bf-text-muted">Import reads ITK-SNAP .txt, FreeSurfer LUT and BIDS dseg.tsv.</span>
      </SheetPart>
    </SideSheet>
  );
}

export function SetupState() {
  const empty = primaryView('empty');
  const view = { ...empty, crosshair: null };
  return (
    <HShell testState="setup" mode="trace" status={<StatusItem label="Session" value="not started" mono={false} />} rail={<ToolRail state="empty" />} inspector={<SetupSheet />}>
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Set up</StateChip>}
            title={<GeometryTitle image={view.image} />}
            right={<span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(view.fovMm)}</span>}
            line2={<span className="px-1 text-bf-xs text-bf-text-muted">The grid the labels will live on: 20 native slices, k 1 posterior to k 20 anterior</span>}
            view={view}
            ariaLabel="Primary view, the reference grid"
          />
        }
      />
    </HShell>
  );
}

