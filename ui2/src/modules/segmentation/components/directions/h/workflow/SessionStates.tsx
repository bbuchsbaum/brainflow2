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
import { FolderOpen, History, Plus } from 'lucide-react';
import { Button, Checkbox, SegmentedControl, Select, Switch, TextField } from '@/components/ui/bf';
import { StatusItem, Swatch } from '@/modules/segmentation/components/shared/chrome';
import { fmtInt, fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_DEFS, NATIVE_GEOMETRY, PROTOCOL, labelTint } from '@/modules/segmentation/components/shared/mockData';
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
  SessionHeader,
  Sep,
  SliceRuler,
  StepCard,
  StepNext,
  TextToggle,
  ToolRail,
} from '@/modules/segmentation/components/directions/h/DirectionH';
import { SLICE_K, hPrimary, islandOverlay, neighbourOverlay, strokeLabels } from '@/modules/segmentation/components/directions/h/hViews';
import { ChoiceRow, FilePreview, OrthoColumn, PrimaryPanel, SheetPart, SideSheet, StateChip, TraceGrid } from './parts';
import { CANDIDATES, JOURNAL, LAST_STROKE, NEW_LABEL_DEF, SAVE } from './workflowData';

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

const FILES = [
  { name: `${SAVE.base}_dseg.nii.gz`, what: 'label volume' },
  { name: `${SAVE.base}_dseg.tsv`, what: 'BIDS label table' },
  { name: `${SAVE.base}_dseg.itksnap.txt`, what: 'ITK-SNAP labels' },
  { name: `${SAVE.base}_dseg.json`, what: 'provenance sidecar' },
  { name: `${SAVE.base.replace('desc-subfields', 'desc-provenance')}_dseg.nii.gz`, what: 'per-voxel provenance' },
];

const SIDECAR = [
  `"Rater": "Rater A", "ProtocolPack": "${PROTOCOL.version}",`,
  '"ReferenceImage": "sub-01_T2w.nii.gz", "sha256": "9f3c…e21a",',
  `"TimeOnTask": { "total": "${SAVE.timeOnTask.total}", "navigation": "${SAVE.timeOnTask.navigation}",`,
  `  "drawing": "${SAVE.timeOnTask.drawing}", "correction": "${SAVE.timeOnTask.correction}" },`,
  '"History": { "steps": 38, "branches": 1 }, "AI": null,',
  '"Software": "Brainflow 0.9.0, segmentation (experimental)"',
];

function SaveSheet() {
  return (
    <SideSheet
      title="Save segmentation"
      meta={`${SAVE.stepsUnsaved} steps since the last save`}
      testId="save-sheet"
      footer={
        <>
          <Button variant="primary" title="Save (⌘S): writes every file below, each through a temporary file and a rename" data-testid="save-button">
            Save
          </Button>
          <Button variant="ghost">Cancel</Button>
          <span className="ml-auto text-bf-2xs text-bf-text-muted">{FILES.length} files · replaces nothing</span>
        </>
      }
    >
      <SheetPart n={1} title="Label volume" meta="always written" testId="save-volume">
        <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-bf-xs" data-testid="nifti-header">
          <dt className="text-bf-text-muted">format</dt>
          <dd className="m-0 text-bf-text-primary">NIfTI-1, gzip</dd>
          <dt className="text-bf-text-muted">data type</dt>
          <dd className="m-0 font-mono text-bf-text-primary">{SAVE.header.datatype}</dd>
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
      </SheetPart>
      <SheetPart n={2} title="Label table" meta="beside the volume" testId="save-tables">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bf-xs">
          <Checkbox defaultChecked>BIDS dseg.tsv</Checkbox>
          <Checkbox defaultChecked>ITK-SNAP labels</Checkbox>
          <Checkbox>FreeSurfer LUT</Checkbox>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-bf-2xs text-bf-text-muted">Preview</span>
          <SegmentedControl
            aria-label="Table preview"
            size="sm"
            value="dseg"
            onValueChange={() => undefined}
            options={[
              { value: 'dseg', label: 'dseg.tsv' },
              { value: 'itk', label: 'ITK-SNAP' },
              { value: 'fs', label: 'FreeSurfer' },
            ]}
          />
          <span className="ml-auto text-bf-2xs text-bf-text-muted" title="The parent column carries the hierarchy; a flat target drops it">
            parent kept as a column
          </span>
        </div>
        <FilePreview lines={SAVE.tables.dseg} max={3} testId="table-preview" />
      </SheetPart>
      <SheetPart n={3} title="Provenance" meta="how every voxel got its label" testId="save-provenance">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bf-xs">
          <Checkbox defaultChecked disabled>
            Sidecar JSON
          </Checkbox>
          <Checkbox defaultChecked>Per-voxel provenance volume</Checkbox>
        </div>
        <div className="grid grid-cols-[14px_minmax(0,1fr)_56px_14px_minmax(0,1fr)_56px] gap-x-2 font-mono text-bf-2xs text-bf-text-secondary" data-testid="provenance-codes">
          {SAVE.provenanceCodes.map((c) => (
            <React.Fragment key={c.code}>
              <span className="text-right text-bf-text-muted">{c.code}</span>
              <span className="font-sans">{c.name}</span>
              <span className="text-right tabular-nums">{fmtInt(c.vx)} vx</span>
            </React.Fragment>
          ))}
        </div>
        <FilePreview lines={SIDECAR} max={6} testId="sidecar-preview" />
      </SheetPart>
      <SheetPart n={4} title="Destination" testId="save-destination">
        <div className="flex items-center gap-1.5">
          <TextField aria-label="Folder" defaultValue={SAVE.folder} className="min-w-0 flex-1 font-mono" />
          <Button variant="secondary" size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />}>
            Choose…
          </Button>
        </div>
        <div className="flex items-center gap-2 text-bf-xs text-bf-text-secondary">
          <Switch checked aria-label="BIDS derivatives layout" />
          BIDS derivatives layout
          <span className="ml-auto text-bf-2xs text-bf-text-muted">dataset_description.json exists</span>
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
            line2={<BrushStrip />}
            view={view}
            ruler={<SliceRuler state="tracing" />}
          />
        }
      />
    </HShell>
  );
}

// ----------------------------------------------------------------- resume

const RECOVERED_STEPS = JOURNAL.step - 26;

/** The banner above the image: what was recovered, what was restored, and the choice. */
function RecoveredBanner() {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-bf-border-subtle bg-bf-bg-panel px-3 py-2" role="status" data-testid="recovered-banner">
      <div className="flex items-start gap-2 text-bf-xs">
        <History className="mt-px h-3.5 w-3.5 shrink-0 text-bf-text-secondary" aria-hidden />
        <span className="text-bf-text-secondary">
          <span className="text-bf-text-primary">Recovered {RECOVERED_STEPS} steps from the journal.</span> Brainflow closed unexpectedly at 14:31:52; the
          last save was {JOURNAL.lastSave.time}. Nothing was lost after step {JOURNAL.step}.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] font-mono text-bf-2xs text-bf-text-muted" data-testid="restored-view">
        <span className="font-sans text-bf-text-secondary">Restored</span>
        k {SLICE_K} <Sep /> CA1 <Sep /> brush ⌀ 3.0 mm <Sep /> 4.0× <Sep /> T2w window 12–230 <Sep /> step 6/9 <Sep /> last edit 14:31:48
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
      className="pointer-events-none absolute -translate-x-full whitespace-nowrap rounded-sm bg-bf-bg-canvas/80 px-1 text-bf-2xs leading-4 text-bf-text-primary"
      style={{ left: at.x, top: at.y - 8 }}
      data-testid="last-edit-tag"
    >
      last edit · 14:31
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
            line2={<BrushStrip />}
            banner={<RecoveredBanner />}
            view={view}
            overlay={(p) => <LastEditTag p={p} />}
            ruler={<SliceRuler state="tracing" marks={{ [SLICE_K]: { mark: 'solid', note: 'last', title: `k ${SLICE_K} · last edit 14:31:48` } }} />}
          />
        }
        side={<OrthoColumn />}
      />
    </HShell>
  );
}

// ------------------------------------------------------------------ setup

function ColourPicker() {
  return (
    <div className="flex flex-col gap-1" data-testid="colour-picker">
      <div className="grid grid-cols-11 gap-1">
        {CANDIDATES.map((c) => {
          const selected = c.color === NEW_LABEL_DEF.color;
          return (
            <button
              key={c.color}
              type="button"
              disabled={!c.ok}
              aria-pressed={selected}
              aria-label={c.ok ? `Colour ${c.color}` : `Colour ${c.color}: ${c.reason}`}
              title={c.ok ? c.color : `Not offered: ${c.reason}`}
              className={clsx(
                'relative h-5 w-full rounded-[2px] p-0',
                selected && 'outline outline-2 outline-offset-1 outline-bf-text-primary',
                !c.ok && 'cursor-not-allowed opacity-35',
              )}
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
        })}
      </div>
      <span className="text-bf-2xs text-bf-text-muted">
        Offered only when its tints differ from every label's by ΔE ≥ {MUTED_MIN_DELTA_E} and from the crosshair and warning by ≥ {RESERVED_MIN_DELTA_E}.{' '}
        {CANDIDATES.filter((c) => !c.ok).length} of {CANDIDATES.length} not offered.
      </span>
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
      <SheetPart n={1} title="Reference grid" meta="labels are stored here, voxel for voxel" testId="setup-grid">
        <ChoiceRow
          selected
          title={
            <span>
              T2w · native oblique <span className="font-mono text-bf-text-secondary">{NATIVE_GEOMETRY}</span>
            </span>
          }
          detail="20 slices ⊥ the hippocampal long axis, tilted 12° and 30° from the world axes. The pack traces here."
          testId="grid-t2"
        />
        <ChoiceRow
          selected={false}
          title={
            <span>
              T1w · <span className="font-mono text-bf-text-secondary">1.0 mm isotropic</span>
            </span>
          }
          detail="Coarser than the pack's T2w rules need; T2w would reslice to it for display."
        />
      </SheetPart>
      <SheetPart n={2} title="Label table" testId="setup-table">
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
          options={[
            { value: 'hip', label: `${PROTOCOL.name} · ${PROTOCOL.version} · 6 labels, 9 steps` },
            { value: 'wmh', label: 'White-matter lesions · example pack v0.1 · 1 label' },
          ]}
        />
        <div className="grid grid-cols-[14px_20px_minmax(0,1fr)_96px] items-center gap-x-2 text-bf-xs text-bf-text-secondary" data-testid="setup-labels">
          {LABEL_DEFS.map((d) => (
            <React.Fragment key={d.id}>
              <Swatch color={d.color} size={9} />
              <span className="font-mono text-bf-2xs text-bf-text-muted">{d.id}</span>
              <span className="truncate">{d.long}</span>
              <span className="truncate text-bf-2xs text-bf-text-muted">Hippocampus</span>
            </React.Fragment>
          ))}
          <Swatch color={NEW_LABEL_DEF.color} size={9} />
          <span className="font-mono text-bf-2xs text-bf-text-muted">{NEW_LABEL_DEF.id}</span>
          <span className="truncate text-bf-text-primary">{NEW_LABEL_DEF.name} · new</span>
          <span className="truncate text-bf-2xs text-bf-text-muted">Hippocampus</span>
        </div>
        <span className="text-bf-2xs text-bf-text-muted">Import reads ITK-SNAP .txt, FreeSurfer LUT and BIDS dseg.tsv.</span>
      </SheetPart>
      <SheetPart n={3} title="New label" meta="added to this session, not to the pack" testId="setup-new-label">
        <div className="grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] gap-2">
          <label className="flex flex-col gap-1 text-bf-2xs text-bf-text-muted">
            Name
            <TextField aria-label="Name" defaultValue={NEW_LABEL_DEF.name} />
          </label>
          <label className="flex flex-col gap-1 text-bf-2xs text-bf-text-muted">
            Id
            <TextField aria-label="Id" defaultValue={String(NEW_LABEL_DEF.id)} className="font-mono" title="Next free id; ids 1–6 are the pack's" />
          </label>
          <label className="flex flex-col gap-1 text-bf-2xs text-bf-text-muted">
            Parent
            <Select aria-label="Parent" defaultValue="hip" options={[{ value: 'hip', label: 'Hippocampus' }, { value: 'none', label: 'None (top level)' }]} />
          </label>
        </div>
        <ColourPicker />
        <div className="flex items-center gap-2">
          <StrokePreview />
          <Button variant="secondary" size="sm" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />}>
            Add label
          </Button>
        </div>
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

