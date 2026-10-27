/* eslint-disable react-refresh/only-export-components -- dev-only entry module
 * (mounts to the DOM, exports nothing); fast-refresh boundaries don't apply. */

/**
 * Dev-only gallery of the shared `bf` primitives (primitives-harness.html).
 *
 * Every primitive in every state, on the panel ground at realistic widths:
 * default, hover, focus, active/selected, focused + selected, disabled and
 * invalid. Hover and focus are pinned with the primitives' `data-force-hover`
 * / `data-force-focus` twins (see `ui/bf/states.ts`), so one still shows them
 * all. Deterministic: no timers, no animation, no backend.
 *
 * Not part of the production bundle: Vite builds only index.html. Captured by
 * e2e/harness/app-harness.capture.spec.ts when APP_HARNESS_SCENARIOS includes
 * `primitives` (`?page=1|2|3|4`).
 */
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../index.css';
import '../components/ui/StatusBar.css';

import React, { StrictMode, useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brain,
  Database,
  Download,
  Eye,
  Folder,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Checkbox,
  Chip,
  ColorInput,
  FieldRow,
  FilterChip,
  formatName,
  IconButton,
  JobStatusPill,
  KeyValue,
  Notice,
  NumberField,
  Pager,
  RangeSlider,
  Section,
  SegmentedControl,
  Select,
  SelectableRow,
  Slider,
  StatusPill,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Toolbar,
  ToolbarField,
  ToolbarSeparator,
  ValueChip,
  ValueChipError,
} from '@/components/ui/bf';
import { formatLayerValue, formatWorldMmAscii } from '@/utils/valueFormat';

if (!import.meta.env.DEV) throw new Error('The primitives gallery is development-only.');
document.documentElement.classList.add('dark');
// The app shell pins html/body/#root to the viewport (overflow hidden); the
// gallery is a scrolling document so full-page captures include every group.
for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
  if (!el) continue;
  el.style.height = 'auto';
  el.style.overflow = 'visible';
}

// ── forced states ───────────────────────────────────────────────────────────

interface ForceSpec {
  /** CSS selector inside the wrapper. */
  selector: string;
  /** Which match (default 0). */
  index?: number;
  attr: 'data-force-focus' | 'data-force-hover' | 'data-dragging';
  value?: string;
}

/** Pins states on descendants after mount (React leaves attributes it did not render alone). */
function Force({ specs, children }: { specs: ForceSpec[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const s of specs) {
      const el = ref.current?.querySelectorAll(s.selector)[s.index ?? 0];
      el?.setAttribute(s.attr, s.value ?? '');
    }
  });
  return <div ref={ref}>{children}</div>;
}

// ── layout helpers ──────────────────────────────────────────────────────────

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-bf-border pt-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-bf-md font-semibold text-foreground">{title}</h2>
        {note ? <p className="text-bf-xs text-muted-foreground">{note}</p> : null}
      </header>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">{children}</div>
    </section>
  );
}

function Specimen({
  label,
  width,
  children,
  canvas = false,
}: {
  label: string;
  width?: number;
  children: React.ReactNode;
  canvas?: boolean;
}) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5" style={width ? { width } : undefined}>
      <figcaption className="font-mono text-bf-2xs text-bf-text-faint">{label}</figcaption>
      <div className={canvas ? 'bg-bf-bg-canvas p-3' : ''}>{children}</div>
    </figure>
  );
}

const noop = () => {};

// ── specimens ───────────────────────────────────────────────────────────────

const FILES_TABS = [
  { value: 'tree', label: 'Tree' },
  { value: 'bids', label: 'BIDS' },
  { value: 'images', label: 'Images' },
  { value: 'loaded', label: 'Loaded' },
];
const DOCK_TABS = [
  { value: 'activity', label: 'Activity' },
  { value: 'plot', label: 'Plot' },
  { value: 'log', label: 'Log', disabled: true },
];
const GL_TABS = [
  { value: 'axial', label: 'Axial', icon: <Brain className="h-3 w-3" />, onClose: noop },
  { value: 'surface', label: 'Surface', icon: <Layers className="h-3 w-3" />, onClose: noop },
];

function TabsGroup() {
  const strip = 'border-b border-bf-border-subtle bg-bf-bg-shell';
  return (
    <Group
      title="Tabs"
      note="flat, 28px; switch a pane's content. Neutral edge (stays under focus); amber edge only on the focused GoldenLayout stack (hides under focus). Close: Delete on the focused tab or the 24px glyph."
    >
      <Specimen label="default (neutral edge)" width={300}>
        <Tabs className={strip} items={DOCK_TABS} value="activity" onValueChange={noop} />
      </Specimen>
      <Specimen label="hover inactive · disabled tab" width={300}>
        <Force specs={[{ selector: '[role=tab]', index: 1, attr: 'data-force-hover' }]}>
          <Tabs className={strip} items={DOCK_TABS} value="activity" onValueChange={noop} />
        </Force>
      </Specimen>
      <Specimen label="focus inactive" width={300}>
        <Force specs={[{ selector: '[role=tab]', index: 1, attr: 'data-force-focus' }]}>
          <Tabs className={strip} items={DOCK_TABS} value="activity" onValueChange={noop} />
        </Force>
      </Specimen>
      <Specimen label="focus + active (neutral)" width={300}>
        <Force specs={[{ selector: '[role=tab]', index: 0, attr: 'data-force-focus' }]}>
          <Tabs className={strip} items={DOCK_TABS} value="activity" onValueChange={noop} />
        </Force>
      </Specimen>
      <Specimen label="fill (Files view), 320px" width={320}>
        <Tabs className={strip} fill items={FILES_TABS} value="bids" onValueChange={noop} />
      </Specimen>
      <Specimen label="focused GL stack: edge=accent, close" width={300}>
        <Tabs className={strip} edge="accent" items={GL_TABS} value="axial" onValueChange={noop} />
      </Specimen>
      <Specimen label="accent + focus on active" width={300}>
        <Force specs={[{ selector: '[role=tab]', index: 0, attr: 'data-force-focus' }]}>
          <Tabs
            className={strip}
            edge="accent"
            items={GL_TABS}
            value="axial"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="unfocused GL stack (neutral)" width={300}>
        <Tabs className={strip} items={GL_TABS} value="surface" onValueChange={noop} />
      </Specimen>
    </Group>
  );
}

// The app's top-bar switcher (types/displayModes.ts, shown modes).
const WORKSPACES = [
  { value: 'orthogonal', label: 'Orthogonal' },
  { value: 'integrated', label: 'Integrated' },
  { value: 'mosaic', label: 'Mosaic' },
  { value: 'compare', label: 'Compare' },
];
const STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];
const GOTO = [
  { value: 'world', label: 'World (mm)' },
  { value: 'voxel', label: 'Voxel' },
];

function SegmentedGroup() {
  return (
    <Group
      title="SegmentedControl"
      note="joined, 24px items; switch a view's mode. Selected = light primary fill + dark text, no outline, no bottom edge (user decision 2026-10-26; the same 'on' as a pressed FilterChip and an on Switch; tabs keep the edge). Hover on the selected item brightens and draws a 1px dark inner frame (a form cue, not just a 1.16:1 tint). Focus = square ring at offset 1 over a dark 1px gap, so amber never touches the light fill. Workspace switcher only: raised fill + amber edge, 28px (size=md), manual activation (arrows move focus, Enter/Space switch). Min 24px per item; name required."
    >
      <Specimen label="default">
        <SegmentedControl
          aria-label="Line style"
          options={STYLES}
          value="solid"
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="hover inactive">
        <Force specs={[{ selector: '[role=radio]', index: 1, attr: 'data-force-hover' }]}>
          <SegmentedControl
            aria-label="Line style"
            options={STYLES}
            value="solid"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="hover active">
        <Force specs={[{ selector: '[role=radio]', index: 0, attr: 'data-force-hover' }]}>
          <SegmentedControl
            aria-label="Line style"
            options={STYLES}
            value="solid"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="focus inactive">
        <Force specs={[{ selector: '[role=radio]', index: 2, attr: 'data-force-focus' }]}>
          <SegmentedControl
            aria-label="Line style"
            options={STYLES}
            value="solid"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="focus + active">
        <Force specs={[{ selector: '[role=radio]', index: 0, attr: 'data-force-focus' }]}>
          <SegmentedControl
            aria-label="Line style"
            options={STYLES}
            value="solid"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="disabled option · disabled group">
        <div className="flex gap-3">
          <SegmentedControl
            aria-label="Plane"
            options={[
              { value: 'ax', label: 'Ax' },
              { value: 'sag', label: 'Sag', disabled: true },
              { value: 'cor', label: 'Cor' },
            ]}
            value="ax"
            onValueChange={noop}
          />
          <SegmentedControl
            aria-label="Layout"
            disabled
            options={[
              { value: 'row', label: 'Row' },
              { value: 'grid', label: 'Grid' },
            ]}
            value="grid"
            onValueChange={noop}
          />
        </div>
      </Specimen>
      <Specimen label="fullWidth (Go to), 280px" width={280}>
        <SegmentedControl
          aria-label="Coordinates"
          fullWidth
          options={GOTO}
          value="world"
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="workspace switcher: edge=accent, size=md, manual">
        <SegmentedControl
          aria-label="Workspace"
          edge="accent"
          size="md"
          activation="manual"
          options={WORKSPACES}
          value="orthogonal"
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="switcher, focus + active (edge, gap, ring)">
        <Force specs={[{ selector: '[role=radio]', index: 0, attr: 'data-force-focus' }]}>
          <SegmentedControl
            aria-label="Workspace"
            edge="accent"
          size="md"
          activation="manual"
            options={WORKSPACES}
            value="orthogonal"
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="one-letter items ≥ 24px">
        <SegmentedControl
          aria-label="Axis"
          options={[
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
            { value: 'z', label: 'Z' },
          ]}
          value="y"
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="single option: renders nothing" width={160}>
        <div className="flex h-6 items-center border border-dashed border-bf-border-subtle px-2 text-bf-2xs text-bf-text-faint">
          <SegmentedControl
            aria-label="Mode"
            options={[{ value: 'h', label: 'Histogram' }]}
            value="h"
            onValueChange={noop}
          />
          (empty)
        </div>
      </Specimen>
      <Specimen label="single option, singleLabel: plain text" width={160}>
        <SegmentedControl
          aria-label="Plot mode"
          singleLabel
          options={[{ value: 'p', label: 'Population' }]}
          value="p"
          onValueChange={noop}
        />
      </Specimen>
    </Group>
  );
}

function SliderGroup() {
  const W = 280;
  const fmtZ = (v: number) => `z = ${formatWorldMmAscii(v)} mm`;
  return (
    <Group
      title="Slider"
      note="one ruler; data range = 4px marks below the track (no end caps); fill = what is shown (threshold: kept segments light, removed = hatch); hover grows the thumb."
    >
      <Specimen label="single, fill from min, value" width={W}>
        <Slider
          label="Opacity"
          min={0}
          max={1}
          value={0.9}
          showValue
          format={(v) => `${Math.round(v * 100)}%`}
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="hover" width={W}>
        <Force specs={[{ selector: '.group', attr: 'data-force-hover' }]}>
          <Slider
            label="Opacity"
            min={0}
            max={1}
            value={0.45}
            showValue
            format={(v) => `${Math.round(v * 100)}%`}
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="focus" width={W}>
        <Force specs={[{ selector: '[role=slider]', attr: 'data-force-focus' }]}>
          <Slider
            label="Opacity"
            min={0}
            max={1}
            value={0.45}
            showValue
            format={(v) => `${Math.round(v * 100)}%`}
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="disabled" width={W}>
        <Slider
          label="Opacity"
          min={0}
          max={1}
          value={0.45}
          disabled
          showValue
          format={(v) => `${Math.round(v * 100)}%`}
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="single + data marks (on and off the fill)" width={W}>
        <Slider
          label="Gamma"
          min={0}
          max={4}
          dataRange={[0.6, 3.2]}
          value={2}
          showValue
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="range shown (Intensity) + data ticks" width={W}>
        <RangeSlider
          label="Intensity"
          min={-6}
          max={6.15}
          dataRange={[-4.58, 6.15]}
          value={[-6, 6]}
          showValue
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="range hidden (Threshold) + data ticks" width={W}>
        <RangeSlider
          label="Threshold"
          mode="hidden"
          min={-6}
          max={6.15}
          dataRange={[-4.58, 6.15]}
          value={[-2.3, 2.3]}
          showValue
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="range, high thumb focused" width={W}>
        <Force specs={[{ selector: '[role=slider]', index: 1, attr: 'data-force-focus' }]}>
          <RangeSlider
            label="Threshold"
            mode="hidden"
            min={-6}
            max={6.15}
            dataRange={[-4.58, 6.15]}
            value={[-2.3, 2.3]}
            showValue
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="rail (slice scrubber), rest" width={W + 40} canvas>
        <Slider
          variant="rail"
          label="Axial slice position"
          min={-72}
          max={90}
          step={2}
          value={17.5}
          valueText={fmtZ}
          onValueChange={noop}
        />
      </Specimen>
      <Specimen label="rail, hover / dragging" width={W + 40} canvas>
        <Force specs={[{ selector: '.group', attr: 'data-dragging', value: 'true' }]}>
          <Slider
            variant="rail"
            label="Axial slice position"
            min={-72}
            max={90}
            step={2}
            value={-30}
            valueText={fmtZ}
            onValueChange={noop}
          />
        </Force>
      </Specimen>
      <Specimen label="rail, focus" width={W + 40} canvas>
        <Force
          specs={[
            { selector: '.group', attr: 'data-force-hover' },
            { selector: '[role=slider]', attr: 'data-force-focus' },
          ]}
        >
          <Slider
            variant="rail"
            label="Axial slice position"
            min={-72}
            max={90}
            step={2}
            value={60}
            valueText={fmtZ}
            onValueChange={noop}
          />
        </Force>
      </Specimen>
    </Group>
  );
}

function SectionGroup() {
  const W = 320;
  const body = (
    <p className="text-bf-sm text-muted-foreground">
      Section body: controls sit here, 12px padding.
    </p>
  );
  return (
    <Group
      title="Section"
      note="32px header; icon? + title + meta (numeric = mono) + chevron (down = open, right = closed); actions = ghost button, centred, inside the column; group, not landmark."
    >
      <Specimen label="open, icon + meta" width={W}>
        <div className="bg-background">
          <Section
            divider={false}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            title="Render"
            meta="volume"
          >
            {body}
          </Section>
          <Section
            icon={<Database className="h-3.5 w-3.5" />}
            title="Data"
            defaultOpen={false}
            meta="91 × 109 × 91"
          >
            {body}
          </Section>
          <Section icon={<Eye className="h-3.5 w-3.5" />} title="View behavior" defaultOpen={false}>
            {body}
          </Section>
        </div>
      </Specimen>
      <Specimen label="hover header · focused header" width={W}>
        <Force
          specs={[
            { selector: 'button[aria-expanded]', index: 0, attr: 'data-force-hover' },
            { selector: 'button[aria-expanded]', index: 1, attr: 'data-force-focus' },
          ]}
        >
          <Section divider={false} title="Contract" defaultOpen={false}>
            {body}
          </Section>
          <Section title="Last job" defaultOpen={false} meta="2 min ago">
            {body}
          </Section>
        </Force>
      </Specimen>
      <Specimen label="static + actions" width={W}>
        <Section
          variant="static"
          divider={false}
          title="Active crosshair"
          actions={
            <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3 w-3" />}>
              Reset
            </Button>
          }
        >
          {body}
        </Section>
      </Specimen>
    </Group>
  );
}

function FieldGroup() {
  const W = 320;
  return (
    <Group
      title="FieldRow / KeyValue"
      note="named label column (narrow 96 / wide 148); controls start at the column and are 24px; the row wires label, describedby, invalid and disabled onto the control; KeyValue: every number / identifier mono."
    >
      <Specimen label="inline rows, narrow (96px) label column" width={W}>
        <div className="bg-background px-3">
          <FieldRow label="Blend mode">
            <Select
              defaultValue="alpha"
              options={[
                { value: 'alpha', label: 'Alpha' },
                { value: 'additive', label: 'Additive' },
              ]}
            />
          </FieldRow>
          <FieldRow label="Opacity" meta="90%">
            <Slider
              label="Opacity"
              min={0}
              max={1}
              value={0.9}
              onValueChange={noop}
              className="w-full"
            />
          </FieldRow>
          <FieldRow label="Interpolation">
            <SegmentedControl
              aria-label="Interpolation"
              options={[
                { value: 'n', label: 'Nearest' },
                { value: 'l', label: 'Linear' },
              ]}
              value="l"
              onValueChange={noop}
            />
          </FieldRow>
          <FieldRow label="Origin x">
            <NumberField defaultValue={-37.5} unit="mm" />
          </FieldRow>
          <FieldRow label="Visible">
            <Switch checked onCheckedChange={noop} aria-label="Visible" />
          </FieldRow>
        </div>
      </Specimen>
      <Specimen label="invalid (auto-wired) · disabled" width={W}>
        <div className="bg-background px-3">
          <FieldRow label="Origin y" error="Must be between −126 and 90">
            <NumberField defaultValue={250} unit="mm" />
          </FieldRow>
          <FieldRow label="Origin z" disabled>
            <NumberField defaultValue={17.5} unit="mm" />
          </FieldRow>
        </div>
      </Specimen>
      <Specimen label="stacked + hint (AA muted)" width={W}>
        <div className="bg-background px-3">
          <FieldRow
            layout="stacked"
            label="Bound input"
            meta="volume"
            hint="Relative to the mounted dataset"
          >
            <TextField mono defaultValue="sub-01/anat/sub-01_T1w.nii.gz" />
          </FieldRow>
        </div>
      </Specimen>
      <Specimen label="KeyValue grid, boxed (Data card)" width={W}>
        <KeyValue
          boxed
          items={[
            { label: 'Shape', value: '91 × 109 × 91' },
            { label: 'Range', value: '−4.58 to 6.15' },
            { label: 'Voxel size', value: '2.00 mm' },
            { label: 'TR', value: '2.0', unit: 's' },
            { label: 'Space', value: 'MNI152NLin2009cAsym' },
          ]}
        />
      </Specimen>
      <Specimen label="KeyValue rows (image header), labelWidth=wide (148px)" width={420}>
        <KeyValue
          layout="rows"
          labelWidth="wide"
          items={[
            { label: 'File', value: 'sub-01_task-motor_zstat1.nii.gz' },
            { label: 'Dimensions', value: '91 × 109 × 91' },
            { label: 'Pixel dimensions', value: '2.00 × 2.00 × 2.00', unit: 'mm' },
            { label: 'qform code', value: '4 (MNI)' },
            { label: 'Description', value: 'Group z-statistic, motor task', mono: false },
          ]}
        />
      </Specimen>
    </Group>
  );
}

function RowGroup() {
  return (
    <Group
      title="SelectableRow"
      note="selected = #36383d fill + 2px inset amber left edge; focus = inset 2px ring, border-aware, 2px clear of the edge on rows AND cards; nested controls never select the row."
    >
      <Specimen label="tree rows, 260px" width={260}>
        <div role="tree" aria-label="Files" className="bg-background py-1">
          <SelectableRow role="treeitem" aria-level={1} tabIndex={-1}>
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> default
          </SelectableRow>
          <SelectableRow role="treeitem" aria-level={1} tabIndex={-1} data-force-hover="">
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> hover
          </SelectableRow>
          <SelectableRow role="treeitem" aria-level={2} indent={1} tabIndex={-1} selected>
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> selected
          </SelectableRow>
          <SelectableRow
            role="treeitem"
            aria-level={2}
            indent={1}
            tabIndex={-1}
            data-force-focus=""
          >
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> focused
          </SelectableRow>
          <SelectableRow
            role="treeitem"
            aria-level={2}
            indent={1}
            tabIndex={-1}
            selected
            data-force-focus=""
          >
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> focused + selected
          </SelectableRow>
          <SelectableRow role="treeitem" aria-level={2} indent={1} disabled>
            <Folder className="h-3.5 w-3.5 text-muted-foreground" /> disabled
          </SelectableRow>
          <SelectableRow role="treeitem" aria-level={1} tabIndex={-1} title="MNI152_T1_2mm_brain_mask.nii.gz">
            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 font-mono text-bf-xs">
              {formatName('MNI152_T1_2mm_brain_mask.nii.gz', 26)}
            </span>
            <IconButton size="xs" icon={<Eye />} aria-label="Hide layer" />
          </SelectableRow>
        </div>
      </Specimen>
      {(
        [
          ['card, default', {}],
          ['card, hover', { 'data-force-hover': '' }],
          ['card, selected', { selected: true }],
          ['card, focused + selected', { selected: true, 'data-force-focus': '' }],
        ] as const
      ).map(([label, props]) => (
        <Specimen key={label} label={label} width={240}>
          <div role="listbox" aria-label={label} className="bg-background p-1">
            <SelectableRow variant="card" tabIndex={-1} {...props}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-bf-sm font-medium text-foreground">Smooth volume</span>
                <Chip>Builtin</Chip>
              </div>
              <span className="text-bf-xs text-muted-foreground">Gaussian kernel, FWHM in mm</span>
            </SelectableRow>
          </div>
        </Specimen>
      ))}
    </Group>
  );
}

function PillGroup() {
  return (
    <Group
      title="StatusPill · Chip · FilterChip"
      note="pills 20px: semantic = tinted hairline; neutral = icon + muted text, no border; queued = clock. Static chip (20, filled) ≠ filter chip (24, bordered; name 'label, count'; on = the segmented light fill, no tab edge)."
    >
      <Specimen label="StatusPill">
        <div className="flex flex-wrap gap-2">
          <StatusPill status="success" />
          <StatusPill status="running" />
          <StatusPill status="queued" />
          <StatusPill status="failed" />
          <StatusPill status="failed" blocking>
            Failed: out of memory
          </StatusPill>
          <StatusPill status="cancelled" />
          <StatusPill status="warning">3 warnings</StatusPill>
          <StatusPill status="neutral" icon={false}>
            Not run
          </StatusPill>
        </div>
      </Specimen>
      <Specimen label="JobStatusPill (re-export)">
        <div className="flex flex-wrap gap-2">
          {['completed', 'running', 'queued', 'failed', 'cancelled'].map((s) => (
            <JobStatusPill key={s} state={s} />
          ))}
        </div>
      </Specimen>
      <Specimen label="Chip (static tag, 20px, filled, no border)">
        <div className="flex flex-wrap gap-2">
          <Chip>Sidecar</Chip>
          <Chip mono>v1.2.0</Chip>
          <Chip>volume</Chip>
          <Chip icon={<Database className="h-3 w-3" />}>Demo data</Chip>
        </div>
      </Specimen>
      <Specimen label="FilterChip: off · hover · on · hover + on · focus · focus + on · disabled">
        <div className="flex flex-wrap gap-2">
          <FilterChip pressed={false}>sub-01</FilterChip>
          <FilterChip pressed={false} data-force-hover="">
            sub-02
          </FilterChip>
          <FilterChip pressed count={12}>
            control
          </FilterChip>
          <FilterChip pressed data-force-hover="">
            case
          </FilterChip>
          <FilterChip pressed={false} data-force-focus="">
            case
          </FilterChip>
          <FilterChip pressed data-force-focus="">
            Linear Y
          </FilterChip>
          <FilterChip pressed={false} disabled>
            sub-03
          </FilterChip>
        </div>
      </Specimen>
    </Group>
  );
}

function NoticeGroup() {
  return (
    <Group
      title="Notice"
      note="panel: 2px left hairline + icon (every severity) + text, no box. Canvas: boxed on a 90% black ground (warning ≥ 4.5:1 over white)."
    >
      <Specimen label="panel, 360px" width={360}>
        <div className="flex flex-col gap-2 bg-background">
          <Notice severity="neutral" role={undefined}>
            No image loaded in this view.
          </Notice>
          <Notice severity="info">Surface is linked to the volume crosshair.</Notice>
          <Notice severity="success">Compare ready.</Notice>
          <Notice severity="warning">Surface and volume are in different spaces.</Notice>
          <Notice
            severity="danger"
            action={
              <Button variant="link" size="sm">
                Retry
              </Button>
            }
          >
            Remote mount disconnected.
          </Notice>
        </div>
      </Specimen>
      <Specimen label="canvas surface (over a white image region)" width={420} canvas>
        <div
          className="relative flex h-[132px] flex-col justify-end gap-2 p-2"
          style={{
            background: 'linear-gradient(90deg, rgb(255 255 255) 0 55%, rgb(120 120 120) 75%, rgb(0 0 0))',
          }}
        >
          <Notice surface="canvas" severity="info" icon={false} className="self-start font-mono">
            fsaverage5 · pial · 10242 vertices
          </Notice>
          <Notice surface="canvas" severity="warning" className="self-start">
            Volume crosshair is outside the surface bounds.
          </Notice>
        </div>
      </Specimen>
    </Group>
  );
}

// ── page 3: controls, fields, pager, toolbar, slider details, names ─────────

function ButtonGroup() {
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'link'] as const;
  return (
    <Group
      title="Button · IconButton"
      note="24px (size sm / xs). primary = light neutral; secondary = raised + border; ghost; danger; link = underlined. Square outer focus ring."
    >
      {(
        [
          ['default', {}],
          ['hover', { 'data-force-hover': '' }],
          ['focus', { 'data-force-focus': '' }],
          ['disabled', { disabled: true }],
        ] as const
      ).map(([state, props]) => (
        <Specimen key={state} label={`Button sm, ${state}`}>
          <div className="flex flex-wrap items-center gap-2">
            {variants.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={v}
                {...props}
                className={state === 'hover' && v !== 'link' ? HOVER_BY_VARIANT[v] : undefined}
              >
                {v === 'primary' ? 'Run analysis' : v === 'danger' ? 'Delete' : v === 'link' ? 'Retry' : v === 'secondary' ? 'Open' : 'Reset'}
              </Button>
            ))}
          </div>
        </Specimen>
      ))}
      <Specimen label="Button with icon · loading">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />}>
            Load
          </Button>
          <Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />}>
            Run
          </Button>
          <Button size="sm" variant="secondary" loading>
            Mount
          </Button>
        </div>
      </Specimen>
      <Specimen label="IconButton xs (24×24): ghost · secondary · pressed · focus · disabled">
        <div className="flex items-center gap-2">
          <IconButton size="xs" icon={<MoreHorizontal />} aria-label="More" />
          <IconButton size="xs" variant="secondary" icon={<Download />} aria-label="Export" />
          <IconButton size="xs" icon={<Eye />} aria-label="Visible" pressed />
          <IconButton size="xs" icon={<RotateCcw />} aria-label="Reset" data-force-focus="" />
          <IconButton size="xs" variant="danger" icon={<Trash2 />} aria-label="Remove" />
          <IconButton size="xs" icon={<Trash2 />} aria-label="Remove" disabled />
        </div>
      </Specimen>
    </Group>
  );
}

const HOVER_BY_VARIANT = {
  primary: 'bg-primary/90',
  secondary: 'bg-accent',
  ghost: 'bg-accent text-foreground',
  danger: 'bg-destructive/25',
} as const;

function FieldsGroup() {
  const W = 220;
  return (
    <Group
      title="TextField · NumberField · Select · Switch"
      note="24px; mono for numbers and paths; unit as a muted suffix outside the editable text; invalid = danger border + aria-invalid, always with a message (FieldRow error)."
    >
      {(
        [
          ['default', {}],
          ['hover', { 'data-force-hover': '' }],
          ['focus', { 'data-force-focus': '' }],
          ['invalid', { invalid: true }],
          ['disabled', { disabled: true }],
        ] as const
      ).map(([state, props]) => (
        <Specimen key={state} label={state} width={W}>
          <Force
            specs={
              state === 'focus'
                ? [
                    { selector: 'input[type=text]', attr: 'data-force-focus' },
                    { selector: 'select', attr: 'data-force-focus' },
                  ]
                : []
            }
          >
            <div className="flex flex-col gap-2">
              <TextField
                aria-label="Name"
                defaultValue="motor_contrast"
                {...props}
                className={state === 'hover' ? 'border-bf-border-strong' : undefined}
              />
              <NumberField
                aria-label="Smoothing"
                defaultValue={state === 'invalid' ? 250 : 6}
                unit="mm"
                {...props}
                fieldClassName={
                  state === 'hover'
                    ? 'border-bf-border-strong'
                    : state === 'focus'
                      ? 'z-10 rounded-none outline outline-2 outline-offset-1 outline-[var(--bf-border-focus)]'
                      : undefined
                }
              />
              <Select
                aria-label="Mark"
                defaultValue="line"
                options={[
                  { value: 'line', label: 'Line' },
                  { value: 'point', label: 'Point' },
                ]}
                {...props}
                className={state === 'hover' ? 'border-bf-border-strong' : undefined}
              />
            </div>
          </Force>
        </Specimen>
      ))}
      <Specimen label="Switch: off · on · focus · disabled" width={W}>
        <div className="flex flex-col gap-1">
          <Switch checked={false} onCheckedChange={noop}>
            Show crosshair
          </Switch>
          <Switch checked onCheckedChange={noop}>
            Link to volume
          </Switch>
          <Switch checked onCheckedChange={noop} data-force-focus="">
            Interpolate
          </Switch>
          <Switch checked={false} disabled onCheckedChange={noop}>
            Sync time
          </Switch>
        </div>
      </Specimen>
    </Group>
  );
}

function PagerToolbarGroup() {
  const [page, setPage] = useState(3);
  return (
    <Group
      title="Pager · Toolbar"
      note={'pager: "‹ 3 of 6 ›", 24px buttons named "Previous / Next <noun>". Toolbar: 32px row of label + 24px control pairs, hairline between groups.'}
    >
      <Specimen label="Pager (middle · first · last)">
        <div className="flex items-center gap-4">
          <Pager noun="member" page={page} count={6} onPageChange={setPage} />
          <Pager noun="page" page={1} count={6} onPageChange={noop} />
          <Pager noun="page" page={6} count={6} onPageChange={noop} />
        </div>
      </Specimen>
      <Specimen label="Toolbar (plot dock), 720px" width={720}>
        <Toolbar aria-label="Plot" className="border-b border-bf-border-subtle bg-bf-bg-shell">
          <ToolbarField label="Mark">
            <Select
              className="w-24"
              defaultValue="line"
              options={[
                { value: 'line', label: 'Line' },
                { value: 'point', label: 'Point' },
                { value: 'bar', label: 'Bar' },
              ]}
            />
          </ToolbarField>
          <ToolbarField label="X">
            <Select className="w-28" defaultValue="t" options={[{ value: 't', label: 'Timepoint' }]} />
          </ToolbarField>
          <ToolbarField label="Y">
            <Select className="w-28" defaultValue="v" options={[{ value: 'v', label: 'Value' }]} />
          </ToolbarField>
          <ToolbarSeparator />
          <FilterChip pressed>Linear Y</FilterChip>
          <SegmentedControl
            aria-label="Band"
            options={[
              { value: 'sem', label: 'SEM' },
              { value: 'sd', label: 'SD' },
              { value: 'none', label: 'None' },
            ]}
            value="sem"
            onValueChange={noop}
          />
          <span className="ml-auto">
            <IconButton size="xs" icon={<Download />} aria-label="Export plot" />
          </span>
        </Toolbar>
      </Specimen>
    </Group>
  );
}

/**
 * The app's Intensity / Threshold composition (Inspector RenderSection
 * `InspectorRange`): a stacked FieldRow whose label line carries a compact,
 * right-aligned "low to high" readout of editable value chips, above the
 * track. Clamped to the ruler, low <= high.
 */
function ReadoutRange({
  label,
  min,
  max,
  dataRange,
  initial,
  mode,
  caption,
}: {
  label: string;
  min: number;
  max: number;
  dataRange?: readonly [number, number];
  initial: [number, number];
  mode?: 'shown' | 'hidden';
  caption?: React.ReactNode;
}) {
  const [[low, high], setV] = useState<[number, number]>(initial);
  // Invalid chip drafts report here; the message renders under the slider.
  const [bad, setBad] = useState({ low: false, high: false });
  const errorId = `${useId().replace(/:/g, '')}-chip-error`;
  const readout = (
    <span dir="ltr" className="flex items-baseline gap-1 [unicode-bidi:isolate]">
      <ValueChip
        value={low}
        label={`${label} low`}
        min={min}
        max={max}
        align="end"
        errorId={errorId}
        onInvalidChange={(b) => setBad((p) => (p.low === b ? p : { ...p, low: b }))}
        onCommit={(v) => setV([Math.min(v, high), high])}
      />
      <span aria-hidden className="font-sans">
        to
      </span>
      <ValueChip
        value={high}
        label={`${label} high`}
        min={min}
        max={max}
        align="end"
        errorId={errorId}
        onInvalidChange={(b) => setBad((p) => (p.high === b ? p : { ...p, high: b }))}
        onCommit={(v) => setV([low, Math.max(v, low)])}
      />
    </span>
  );
  return (
    <div>
    <FieldRow label={label} layout="stacked" meta={readout}>
      <RangeSlider
        label={label}
        value={[low, high]}
        min={min}
        max={max}
        mode={mode}
        dataRange={dataRange}
        className="flex-1"
        caption={
          caption ? <span className="block text-right font-mono tabular-nums">{caption}</span> : undefined
        }
        onValueChange={setV}
      />
    </FieldRow>
    <ValueChipError id={errorId} show={bad.low || bad.high} />
    </div>
  );
}

function SliderDetailGroup() {
  return (
    <Group
      title="Slider details"
      note="the app's readout: a compact editable “low to high” pair on the label line (click a chip, type, Enter / Escape; ASCII copy), never at the track ends; an invalid draft's message sits in flow under the slider, never on the track; data-range marks under the track; threshold caption; coincident thumbs separate either way; separate domain."
    >
      <Specimen label="Intensity, readout on the label line, 320px" width={320}>
        <div className="bg-background px-3 py-1">
          <ReadoutRange
            label="Intensity"
            min={-6}
            max={6.15}
            dataRange={[-4.58, 6.15]}
            initial={[-2.1, 4.8]}
          />
        </div>
      </Specimen>
      <Specimen label="Threshold, readout + caption, 320px" width={320}>
        <div className="bg-background px-3 py-1">
          <ReadoutRange
            label="Threshold"
            mode="hidden"
            min={-6}
            max={6.15}
            dataRange={[-4.58, 6.15]}
            initial={[-2.3, 2.3]}
            caption={`|value| ≤ ${formatLayerValue(2.3)} hidden`}
          />
        </div>
      </Specimen>
      <Specimen label="unset threshold [0, 0]: coincident thumbs" width={280}>
        <ReadoutRange
          label="Threshold"
          mode="hidden"
          min={-6}
          max={6.15}
          dataRange={[-4.58, 6.15]}
          initial={[0, 0]}
        />
      </Specimen>
      <Specimen label="chip editing · invalid draft" width={280}>
        <ChipEditingDemo />
      </Specimen>
      <Specimen label="domain [−6, 6] ≠ clamp [−2, 2]" width={280}>
        <Slider
          label="Offset"
          min={-2}
          max={2}
          domain={[-6, 6]}
          value={1.5}
          showValue
          onValueChange={noop}
        />
      </Specimen>
    </Group>
  );
}

/** Opens the first chip and types bad text, so the still shows the invalid editor. */
function ChipEditingDemo() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const chip = ref.current?.querySelector('button');
    chip?.click();
    requestAnimationFrame(() => {
      const input = ref.current?.querySelector('input');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '12 mm');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }, []);
  return (
    <div ref={ref}>
      <ReadoutRange label="Window" min={0} max={600} dataRange={[12, 580]} initial={[40, 420]} />
    </div>
  );
}

const NAMES = [
  'MNI152_T1_2mm_brain.nii.gz',
  'MNI152_T1_2mm_brain_mask.nii.gz',
  'sub-01_task-motor_run-01_zstat1.nii.gz',
  'lh.pial.surf.gii',
  'sub-01_ses-baseline_derivatives',
];

function FormatNameGroup() {
  return (
    <Group
      title="formatName"
      note="middle truncation in the stem; the extension is never cut; separators at the cut are dropped. Columns: max characters."
    >
      <Specimen label="formatName(name, n)" width={760}>
        <table className="font-mono text-bf-xs text-foreground">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-4 font-normal">name</th>
              {[14, 18, 22].map((n) => (
                <th key={n} className="pr-4 font-normal">
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NAMES.map((name) => (
              <tr key={name}>
                <td className="pr-4 text-muted-foreground">{name}</td>
                {[14, 18, 22].map((n) => (
                  <td key={n} className="whitespace-pre pr-4">
                    {formatName(name, n, { isDir: !name.includes('.') })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>
    </Group>
  );
}

// ── page 4: API additions (B2 gap closure) ──────────────────────────────────

function GapAdditionsGroup() {
  const [combine, setCombine] = useState<string[]>(['sub-01 · amygdala']);
  return (
    <Group
      title="API additions"
      note="RangeSlider hiddenActive, Tabs density, per-item data/testId, SelectableRow focusable={false}, formatName keep tail, Chip onRemove, TextArea, Checkbox, ColorInput, KeyValue wrap, Button wrap, Pager label, FieldRow with a slider."
    >
      <Specimen label="RangeSlider hidden · hiddenActive false ([0, 0]) / true" width={300}>
        <div className="flex flex-col gap-3">
          <RangeSlider
            label="Threshold off"
            min={-6}
            max={6}
            mode="hidden"
            hiddenActive={false}
            value={[0, 0]}
            onValueChange={noop}
            showValue
          />
          <RangeSlider
            label="Threshold on"
            min={-6}
            max={6}
            mode="hidden"
            hiddenActive
            value={[-2.3, 2.3]}
            onValueChange={noop}
            showValue
          />
        </div>
      </Specimen>
      <Specimen label='Tabs fill density="compact", 220px' width={220}>
        <Tabs
          fill
          density="compact"
          aria-label="Files view (compact)"
          items={FILES_TABS.map((t) => ({ ...t, testId: `gallery-tab-${t.value}` }))}
          value="images"
          onValueChange={noop}
          className="border-b border-bf-border-subtle"
        />
      </Specimen>
      <Specimen label="SelectableRow focusable={false} inside a treeitem (focus from the owner)" width={260}>
        <div role="tree" aria-label="Files (arborist)" className="bg-background py-1">
          {[
            { name: 'MNI152_T1_2mm_brain.nii.gz', selected: false, focus: false },
            { name: 'MNI152_T1_2mm_brain_mask.nii.gz', selected: true, focus: true },
          ].map((r) => (
            <div key={r.name} role="treeitem" aria-selected={r.selected} tabIndex={-1}>
              <SelectableRow
                focusable={false}
                role="none"
                selected={r.selected}
                className="h-6 gap-0 py-0"
                style={r.focus ? { outline: '2px solid var(--bf-border-focus)', outlineOffset: -6 } : undefined}
              >
                <Brain className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-bf-xs">
                  {formatName(r.name, 14, { keep: 'auto' })}
                </span>
              </SelectableRow>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="formatName keep auto, the Files tree (14 · 16 · 18 · 24)" width={420}>
        <table className="font-mono text-bf-xs text-foreground">
          <tbody>
            {NAMES.slice(0, 3).map((name) => (
              <tr key={name}>
                {[14, 16, 18, 24].map((n) => (
                  <td key={n} className="whitespace-pre pr-4">
                    {formatName(name, n, { keep: 'auto' })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>
      <Specimen label="Chip onRemove (24px target) · KeyValue wrap with Chips" width={320}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip onRemove={noop} removeLabel="scope S001" className="max-w-[200px]">
              <span className="text-muted-foreground">Scope</span> S001
            </Chip>
            <Force specs={[{ selector: 'button', attr: 'data-force-focus' }]}>
              <Chip onRemove={noop}>sub-01</Chip>
            </Force>
          </div>
          <KeyValue
            columns={1}
            wrap
            items={[
              {
                label: 'Inputs',
                value: (
                  <>
                    <Chip mono>volume</Chip>
                    <Chip mono>mask</Chip>
                  </>
                ),
              },
              {
                label: 'Outputs',
                value: (
                  <>
                    <Chip mono>smoothed_volume</Chip>
                    <Chip mono>kernel_report</Chip>
                    <Chip mono>qc_summary_table</Chip>
                  </>
                ),
              },
              { label: 'Path', value: '/data/derivatives/sub-01/anat/sub-01_desc-preproc_T1w.nii.gz' },
            ]}
          />
        </div>
      </Specimen>
      <Specimen label="TextArea (mono) · invalid in FieldRow" width={300}>
        <div className="flex flex-col gap-1">
          <FieldRow layout="stacked" label="JSON">
            <TextArea mono rows={3} defaultValue={'{\n  "fwhm": 6\n}'} />
          </FieldRow>
          <FieldRow layout="stacked" label="JSON (invalid)" error="Unexpected token at line 2">
            <TextArea mono rows={2} defaultValue={'{ fwhm: }'} />
          </FieldRow>
        </div>
      </Specimen>
      <Specimen label="Checkbox: off · on · focused · disabled · wrapping" width={280}>
        <div className="flex flex-col">
          {['sub-01 · amygdala', 'sub-02 · amygdala'].map((label) => (
            <Checkbox
              key={label}
              checked={combine.includes(label)}
              onCheckedChange={(c) =>
                setCombine((ids) => (c ? [...ids, label] : ids.filter((x) => x !== label)))
              }
            >
              {label}
            </Checkbox>
          ))}
          <Force specs={[{ selector: 'input', attr: 'data-force-focus' }]}>
            <Checkbox checked onChange={noop}>
              focused
            </Checkbox>
          </Force>
          <Checkbox checked={false} disabled onChange={noop}>
            disabled
          </Checkbox>
          <Checkbox checked={false} onChange={noop}>
            These sources share this time axis and frame alignment.
          </Checkbox>
        </div>
      </Specimen>
      <Specimen label="ColorInput (showValue) · focused" width={220}>
        <div className="flex flex-col gap-2">
          <FieldRow label="Active" controlId="gallery-color-active">
            <ColorInput showValue value="#e0a63f" onValueChange={noop} />
          </FieldRow>
          <Force specs={[{ selector: 'input', attr: 'data-force-focus' }]}>
            <FieldRow label="Mirror" controlId="gallery-color-mirror">
              <ColorInput showValue value="#4aa3df" onValueChange={noop} />
            </FieldRow>
          </Force>
        </div>
      </Specimen>
      <Specimen label="Button wrap (link rows, BIDS path)" width={240}>
        <div className="flex flex-col items-start gap-1">
          <Button variant="link" size="sm" wrap>
            3 rows have a participant id that matches no member folder
          </Button>
          <Button variant="link" size="sm" wrap className="font-mono">
            sub-01/ses-baseline/anat/sub-01_ses-baseline_acq-mprage_T1w.nii.gz
          </Button>
          <Button variant="secondary" size="sm" wrap>
            Use the issue focus as a cohort in Compare
          </Button>
        </div>
      </Specimen>
      <Specimen label='Pager label="Observations" noun="page"'>
        <Pager label="Observations" noun="page" page={2} count={5} onPageChange={noop} />
      </Specimen>
      <Specimen label="Status bar Diagnostics trigger, focused (inset ring inside the 28px bar)" width={420}>
        <Force specs={[{ selector: '.status-diagnostics-trigger', attr: 'data-force-focus' }]}>
          <div className="status-bar">
            <span className="status-slot">
              <span className="status-label">Value</span>
              <span className="status-value">150</span>
            </span>
            <div className="status-bar__right">
              <Button variant="ghost" size="sm" className="status-diagnostics-trigger">
                Diagnostics
              </Button>
            </div>
          </div>
        </Force>
      </Specimen>
      <Specimen label="FieldRow + Slider (aria-labelledby, no label-for)" width={300}>
        <FieldRow label="Opacity">
          <Slider
            label="Layer opacity"
            min={0}
            max={1}
            step={0.01}
            snap={0.01}
            value={0.7}
            onValueChange={noop}
            showValue
            format={(v) => `${Math.round(v * 100)}%`}
            className="flex-1"
          />
        </FieldRow>
      </Specimen>
    </Group>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

const PAGES: Record<string, React.ComponentType[]> = {
  '1': [TabsGroup, SegmentedGroup, SliderGroup, SectionGroup],
  '2': [FieldGroup, RowGroup, PillGroup, NoticeGroup],
  '3': [ButtonGroup, FieldsGroup, PagerToolbarGroup, SliderDetailGroup, FormatNameGroup],
  '4': [GapAdditionsGroup],
};

function Gallery() {
  const page = new URLSearchParams(location.search).get('page');
  const groups = page && PAGES[page] ? PAGES[page] : [...PAGES['1'], ...PAGES['2'], ...PAGES['3'], ...PAGES['4']];
  return (
    <main className="min-h-screen bg-background px-6 py-5 font-sans text-foreground">
      <h1 className="mb-4 text-bf-lg font-semibold">
        Primitives{' '}
        <span className="font-normal text-muted-foreground">
          ui/bf{page ? ` · page ${page}` : ''}
        </span>
      </h1>
      <div className="flex flex-col gap-6">
        {groups.map((G, i) => (
          <G key={i} />
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

void document.fonts.ready.then(() => {
  requestAnimationFrame(() => {
    (window as unknown as { __harnessReady?: boolean }).__harnessReady = true;
  });
});
