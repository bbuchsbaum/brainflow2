/**
 * Round 5: the history panel (state `history`), a bottom-dock tab under the
 * primary and the orthogonal column, so the image stays at full height.
 *
 * - Named steps, newest first: time, tool, operation, label, voxels changed,
 *   slices, duration. Hovering a step outlines its voxels in the primary
 *   with the brush's neutral outline (an outline, never a label colour).
 * - A branch point: steps undone and then replaced are kept as a side branch
 *   drawn in the graph gutter (dimmed, restorable), never discarded.
 * - Undo per label beside it: each label's latest step, what undoing it
 *   reverts, and what it keeps because a later step changed those voxels.
 * - Autosave and the recovery journal: when it was last written, its size
 *   against the byte budget and the minimum depth, the last save.
 */

import React from 'react';
import clsx from 'clsx';
import { Brush, ChevronDown, Eraser, Layers3, Lock, PenTool, Sparkles, Undo2 } from 'lucide-react';
import { Button, IconButton, Tabs } from '@/components/ui/bf';
import { StatusItem, Swatch } from '@/modules/segmentation/components/shared/chrome';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_BY_ID } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD } from '@/modules/segmentation/components/shared/scenes';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { GeometryTitle, HShell, InspectorFrame, LabelsSection, NeighbourKey, SessionHeader, Sep, SliceRuler, StepCard, TextToggle, ToolRail } from '@/modules/segmentation/components/directions/h/DirectionH';
import { ISLANDS_HERE, hPrimary } from '@/modules/segmentation/components/directions/h/hViews';
import { OrthoColumn, PrimaryPanel, StateChip, TraceGrid } from './parts';
import { BRANCH, HISTORY, JOURNAL, LAST_STROKE, PER_LABEL_UNDO, type HistoryTool } from './workflowData';

const TOOL_ICON: Record<HistoryTool, React.ReactNode> = {
  brush: <Brush className="h-3 w-3" aria-hidden />,
  eraser: <Eraser className="h-3 w-3" aria-hidden />,
  contour: <PenTool className="h-3 w-3" aria-hidden />,
  interpolate: <Layers3 className="h-3 w-3" aria-hidden />,
  ai: <Sparkles className="h-3 w-3" aria-hidden />,
  lock: <Lock className="h-3 w-3" aria-hidden />,
  fill: <Layers3 className="h-3 w-3" aria-hidden />,
};

/** The step hovered in the capture: the latest brush stroke. */
const HOVER_STEP = 38;
const ROW_H = 15;
/** Rows the dock shows by default (it resizes, and collapses to its tab row). */
export const DOCK_ROWS = 8;
const DOCK_ROWS_H = DOCK_ROWS * 15;
/** Tab row, column header, the rows and the footer: about a quarter of the primary at 1440 × 900. */
const DOCK_HEIGHT = 26 + 15 + DOCK_ROWS_H + 15 + 2;


const ACTIVE_ROWS = HISTORY.filter((h) => !h.branch);
const BRANCH_ROWS = HISTORY.filter((h) => h.branch);
/** Active steps shown above the branch row (the branch joins below step 32). */
const SHOWN = ACTIVE_ROWS.filter((h) => h.id > BRANCH.from).slice(0, DOCK_ROWS - 1);
/** One scale for the signed vx bars: the largest change shown. */
const VX_MAX = Math.max(...[...SHOWN, ...BRANCH_ROWS].map((h) => Math.abs(h.delta)));

/** The graph gutter: the active line, the current step, and the kept branch joining at its branch point. */
function Graph({ branch, index, last }: { branch?: boolean; index: number; last?: boolean }) {
  const mid = ROW_H / 2;
  const current = index === 0;
  return (
    <svg width={26} height={ROW_H} aria-hidden className="shrink-0">
      <line x1={7} x2={7} y1={current ? mid : 0} y2={last ? mid : ROW_H} className="stroke-bf-text-muted" strokeWidth={1} />
      {branch ? (
        <>
          <path d={`M18 ${mid} C18 ${ROW_H} 7 ${mid + 4} 7 ${ROW_H + mid}`} fill="none" className="stroke-bf-text-faint" strokeWidth={1} />
          <circle cx={18} cy={mid} r={2.5} className="fill-bf-bg-panel stroke-bf-text-muted" strokeWidth={1} />
        </>
      ) : current ? (
        <circle cx={7} cy={mid} r={3.5} className="fill-bf-text-primary" />
      ) : (
        <circle cx={7} cy={mid} r={2} className="fill-bf-text-secondary" />
      )}
    </svg>
  );
}

/** The signed voxel change as a small bar on one scale (added right of the zero line, removed left), with the number. */
function VxBar({ delta }: { delta: number }) {
  const W = 36;
  const w = delta === 0 ? 0 : Math.max(1, (Math.abs(delta) / VX_MAX) * (W / 2));
  return (
    <span className="flex items-center justify-end gap-1.5" data-vx={delta}>
      <span className="font-mono tabular-nums">{delta === 0 ? '·' : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span>
      <svg width={W} height={8} aria-hidden className="shrink-0">
        <line x1={W / 2} x2={W / 2} y1={0} y2={8} className="stroke-bf-text-faint" strokeWidth={1} />
        {delta ? <rect x={delta > 0 ? W / 2 : W / 2 - w} y={2} width={w} height={4} className="fill-bf-text-secondary" data-signed-bar /> : null}
      </svg>
    </span>
  );
}

const COLS = 'grid-cols-[26px_44px_54px_minmax(0,1fr)_48px_84px_46px_20px]';
const fmtKs = (ks: readonly number[]) => (ks.length === 0 ? 'all' : ks.length === 1 ? `k ${ks[0]}` : `k ${ks[0]}–${ks[ks.length - 1]}`);

function HistoryTable() {
  const branchHead = BRANCH_ROWS[BRANCH_ROWS.length - 1];
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid="history-list">
      <div className={clsx('grid h-[15px] items-center gap-x-2 border-b border-bf-border-subtle px-2 text-bf-2xs leading-[14px] text-bf-text-muted', COLS)}>
        <span />
        <span>#</span>
        <span>time</span>
        <span>step</span>
        <span>label</span>
        <span className="text-right">vx</span>
        <span>slices</span>
        <span className="text-right">s</span>
      </div>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-hidden p-0" aria-label="History steps">
        {SHOWN.map((h, i) => {
          const def = LABEL_BY_ID.get(h.label)!;
          const hovered = h.id === HOVER_STEP;
          return (
            <li
              key={h.id}
              className={clsx('grid items-center gap-x-2 px-2 text-bf-xs', COLS, 'text-bf-text-secondary', hovered && 'bg-bf-bg-hover', i === 0 && 'text-bf-text-primary')}
              style={{ height: ROW_H }}
              data-step={h.id}
              title={`Step ${h.id}: click to go back to here (later steps stay, as a branch)`}
            >
              <Graph index={i} />
              <span className="font-mono text-bf-2xs tabular-nums">{h.id}</span>
              <span className="font-mono text-bf-2xs tabular-nums text-bf-text-muted">{h.time}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-bf-text-muted">{TOOL_ICON[h.tool]}</span>
                <span className="truncate">{h.op}</span>
                {h.unreviewed ? (
                  <span className="shrink-0 text-bf-2xs text-bf-text-muted" data-unreviewed={h.unreviewed}>
                    {h.unreviewed} not reviewed
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 items-center gap-1.5" data-label-cell={h.label}>
                <Swatch color={def.color} size={8} />
                {/* Round 7: the name only where the label changes from the row above (the swatch carries the rest). */}
                {i === 0 || SHOWN[i - 1].label !== h.label ? <span className="truncate" data-label-name>{def.name}</span> : null}
              </span>
              <VxBar delta={h.delta} />
              <span className="font-mono text-bf-2xs text-bf-text-muted">{fmtKs(h.ks)}</span>
              <span className="text-right font-mono text-bf-2xs tabular-nums text-bf-text-muted">{h.secs ?? ''}</span>
            </li>
          );
        })}
        {/* The kept branch, one row at its branch point: what it holds, its AI status, and Restore (a full switch). */}
        <li
          className={clsx('grid items-center gap-x-2 px-2 text-bf-xs text-bf-text-muted', COLS)}
          style={{ height: ROW_H }}
          data-branch="alt"
          data-steps={BRANCH_ROWS.map((h) => h.alias).join(' ')}
          title={`Kept branch: undone at ${BRANCH.undoneAt}, then replaced by steps 32–${JOURNAL.step}. Restore switches to it (the current line is kept as a branch).`}
        >
          <Graph branch index={SHOWN.length} last />
          <span className="font-mono text-bf-2xs">
            {BRANCH_ROWS[BRANCH_ROWS.length - 1].alias}–{BRANCH_ROWS[0].alias}
          </span>
          <span className="font-mono text-bf-2xs tabular-nums">{branchHead.time}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{TOOL_ICON.ai}</span>
            <span className="truncate">Kept branch: {branchHead.op}</span>
            <span className="shrink-0 text-bf-2xs">{BRANCH.unreviewed} not reviewed</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5" data-label-cell={CA1}>
            <Swatch color={LABEL_BY_ID.get(CA1)!.color} size={8} />
            {SHOWN[SHOWN.length - 1]?.label !== CA1 ? <span className="truncate" data-label-name>CA1</span> : null}
          </span>
          <VxBar delta={BRANCH_ROWS.reduce((n, h) => n + h.delta, 0)} />
          <Button
            size="sm"
            variant="ghost"
            className="col-span-2 h-4 justify-start px-0 text-bf-2xs"
            title={`Restore switches to the branch. It brings back ${BRANCH.unreviewed} AI slices not reviewed: they return hollow on the ruler and are warned at save.`}
            data-testid="branch-restore"
          >
            Restore…
          </Button>
        </li>
      </ol>
      <span className="h-[15px] border-t border-bf-border-subtle px-2 text-bf-2xs leading-[14px] text-bf-text-muted">
        ⌘Z undoes the newest; click a step to go back to it · scroll for earlier steps
      </span>
    </div>
  );
}

function PerLabelUndo() {
  return (
    <section className="flex flex-col gap-1" data-testid="per-label-undo">
      <span className="text-bf-xs font-medium text-bf-text-primary">Undo per label</span>
      {PER_LABEL_UNDO.map((u) => {
        const def = LABEL_BY_ID.get(u.label)!;
        return (
          <div key={u.label} className="flex items-center gap-2 text-bf-xs" data-undo-label={u.label}>
            <Swatch color={def.color} size={8} />
            <span className="w-10 shrink-0 truncate text-bf-text-secondary">{def.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-bf-2xs text-bf-text-muted" title={`Undo step ${u.step.id} (${u.step.op}) for ${def.name} only`}>
              #{u.step.id} · {u.revert} vx
              {u.kept ? <span className="text-bf-text-secondary"> · keeps {u.kept}</span> : null}
            </span>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={`Undo ${def.name}'s step ${u.step.id}`}
              icon={<Undo2 />}
              title={`Undo ${def.name}'s step ${u.step.id} only. ${u.kept ? `Keeps ${u.kept} voxels a later step changed (step 37 erased them)` : 'No later step touched these voxels'}`}
            />
          </div>
        );
      })}
    </section>
  );
}

function Journal() {
  return (
    <section className="flex flex-col gap-0.5 font-mono text-bf-2xs text-bf-text-muted" data-testid="journal-status">
      <span className="font-sans text-bf-xs font-medium text-bf-text-primary">Autosave</span>
      <span className="text-bf-text-secondary" title={`Journal at step ${JOURNAL.step}: ${JOURNAL.path}`}>
        journal written {JOURNAL.writtenAgoS} s ago
      </span>
      <span title={`Byte budget ${JOURNAL.budgetMb} MB; keeps at least ${JOURNAL.minDepth} steps`}>
        {JOURNAL.sizeMb}/{JOURNAL.budgetMb} MB · ≥ {JOURNAL.minDepth} steps
      </span>
    </section>
  );
}

function HistoryDock() {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bf-bg-panel" data-testid="history-dock" data-rows={DOCK_ROWS}>
      <span className="absolute inset-x-0 -top-px h-[3px] cursor-row-resize" title="Drag to resize; the dock opens at 8 rows" aria-hidden data-testid="dock-resize" />
      <div className="flex h-[26px] shrink-0 items-center gap-3 border-b border-bf-border-subtle px-2">
        <Tabs
          aria-label="Bottom dock"
          value="history"
          onValueChange={() => undefined}
          items={[
            { value: 'history', label: 'History' },
            { value: 'stats', label: 'Label statistics' },
          ]}
        />
        <span className="flex items-center gap-1 text-bf-2xs text-bf-text-muted" data-testid="history-filter">
          <TextToggle pressed={false} title="Show the steps of one label">
            label: all
          </TextToggle>
          <TextToggle pressed={false} title="Show the steps that touched a slice range">
            k: all
          </TextToggle>
        </span>
        {/* Round 7: the one step count, said once. */}
        <span className="ml-auto font-mono text-bf-2xs text-bf-text-muted" data-testid="step-count">
          {JOURNAL.sinceSave} steps since the {JOURNAL.lastSave.time} save · 1 kept branch
        </span>
        <IconButton aria-label="Collapse the dock" title="Collapse to the tab row (H)" icon={<ChevronDown />} size="sm" variant="ghost" data-testid="dock-collapse" />
      </div>
      <div className="flex min-h-0 flex-1">
        <HistoryTable />
        <div className="w-[256px] shrink-0 border-l border-bf-border-subtle px-3 py-1.5">
          <PerLabelUndo />
        </div>
        <div className="w-[168px] shrink-0 border-l border-bf-border-subtle px-3 py-1.5">
          <Journal />
        </div>
      </div>
    </div>
  );
}

export function HistoryState() {
  const base = hPrimary('tracing');
  const step = HISTORY.find((h) => h.id === HOVER_STEP)!;
  const view = {
    ...base,
    brush: null,
    overlays: [
      ...(base.overlays ?? []),
      // The hovered step's voxels: the brush's neutral outline, never a label colour.
      { kind: 'voxels' as const, voxels: LAST_STROKE, color: 'var(--bf-text-primary)', outline: true, width: 1.25 },
    ],
  };
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <HShell
      testState="history"
      status={
        <>
          <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
          <StatusItem label="Label" value="CA1" mono={false} />
          <StatusItem label="Journal" value={`written ${JOURNAL.writtenAgoS} s ago`} />
        </>
      }
      rail={<ToolRail state="tracing" />}
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" status={`unsaved since ${JOURNAL.lastSave.time} · autosaved`} />
          <StepCard state="tracing" />
          <LabelsSection state="tracing" hover={null} />
        </InspectorFrame>
      }
    >
      <TraceGrid
        dockHeight={DOCK_HEIGHT}
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={<GeometryTitle image={view.image} />}
            right={
              <>
                <span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(view.fovMm)}</span>
                <TextToggle pressed={false} title="Linked contrasts (C)">
                  Contrasts
                </TextToggle>
              </>
            }
            line2={
              <span className="flex items-center gap-2 px-1 font-mono text-bf-xs text-bf-text-muted" data-testid="hover-step">
                <span className="font-sans text-bf-text-secondary">Step {step.id}</span>
                <Sep />
                {step.op} {LABEL_BY_ID.get(CA1)!.name} +{step.delta} vx
                <Sep />
                <span className="font-sans">outlined in the view</span>
              </span>
            }
            line2Right={<NeighbourKey neighbour={false} island={ISLANDS_HERE > 0} />}
            view={view}
            ruler={<SliceRuler state="tracing" />}
          />
        }
        side={<OrthoColumn />}
        dock={<HistoryDock />}
      />
    </HShell>
  );
}
