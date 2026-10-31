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
import { Brush, Eraser, Layers3, Lock, PenTool, Sparkles, Undo2 } from 'lucide-react';
import { Button, Tabs } from '@/components/ui/bf';
import { StatusItem, Swatch } from '@/modules/segmentation/components/shared/chrome';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_BY_ID } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD } from '@/modules/segmentation/components/shared/scenes';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { GeometryTitle, HShell, InspectorFrame, LabelsSection, SessionHeader, Sep, SliceRuler, StepCard, TextToggle, ToolRail } from '@/modules/segmentation/components/directions/h/DirectionH';
import { hPrimary } from '@/modules/segmentation/components/directions/h/hViews';
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
const ROW_H = 18;

/** The graph gutter: the active line, the current step, and the kept branch joining at its branch point. */
function Graph({ id, branch, index }: { id: number; branch?: 'alt'; index: number }) {
  const mid = ROW_H / 2;
  const current = index === 0;
  const tip = branch && id === BRANCH.steps[BRANCH.steps.length - 1];
  const root = branch && id === BRANCH.steps[0];
  return (
    <svg width={26} height={ROW_H} aria-hidden className="shrink-0">
      <line x1={7} x2={7} y1={current ? mid : 0} y2={ROW_H} className="stroke-bf-text-muted" strokeWidth={1} />
      {branch ? (
        <>
          <line x1={18} x2={18} y1={tip ? mid : 0} y2={root ? mid : ROW_H} className="stroke-bf-text-faint" strokeWidth={1} />
          {root ? <path d={`M18 ${mid} C18 ${ROW_H} 7 ${mid + 4} 7 ${ROW_H + mid}`} fill="none" className="stroke-bf-text-faint" strokeWidth={1} /> : null}
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

function HistoryTable() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid="history-list">
      <div className="grid grid-cols-[26px_34px_62px_minmax(0,1fr)_96px_56px_64px_40px] items-center gap-x-2 border-b border-bf-border-subtle px-2 text-bf-2xs leading-5 text-bf-text-muted">
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
        {HISTORY.map((h, i) => {
          const def = LABEL_BY_ID.get(h.label)!;
          const alt = h.branch === 'alt';
          const hovered = h.id === HOVER_STEP;
          return (
            <li
              key={h.id}
              className={clsx(
                'grid grid-cols-[26px_34px_62px_minmax(0,1fr)_96px_56px_64px_40px] items-center gap-x-2 px-2 text-bf-xs',
                alt ? 'text-bf-text-muted' : 'text-bf-text-secondary',
                hovered && 'bg-bf-bg-hover',
                i === 0 && 'text-bf-text-primary',
              )}
              style={{ height: ROW_H }}
              data-step={h.id}
              data-branch={h.branch}
              title={alt ? `On a kept branch: undone at ${BRANCH.undoneAt}, then replaced by steps 32–38. Click to restore this branch (the current line is kept too).` : `Step ${h.id}: click to go back to here (later steps stay, as a branch)`}
            >
              <Graph id={h.id} branch={h.branch} index={i} />
              <span className="font-mono text-bf-2xs tabular-nums">{h.alias ?? h.id}</span>
              <span className="font-mono text-bf-2xs tabular-nums text-bf-text-muted">{h.time}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-bf-text-muted">{TOOL_ICON[h.tool]}</span>
                <span className="truncate">{h.op}</span>
                {alt && h.id === BRANCH.steps[1] ? <span className="shrink-0 text-bf-2xs text-bf-text-muted">· kept branch</span> : null}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Swatch color={def.color} size={8} />
                <span className="truncate">{def.name}</span>
              </span>
              <span className="text-right font-mono tabular-nums">{h.delta === 0 ? '·' : h.delta > 0 ? `+${h.delta}` : `−${Math.abs(h.delta)}`}</span>
              <span className="font-mono text-bf-2xs text-bf-text-muted">{h.k}</span>
              <span className="text-right font-mono text-bf-2xs tabular-nums text-bf-text-muted">{h.secs ?? ''}</span>
            </li>
          );
        })}
      </ol>
      <span className="border-t border-bf-border-subtle px-2 text-bf-2xs leading-5 text-bf-text-muted">28 earlier steps since 13:02 · ⌘Z undoes the newest; click a step to go back to it</span>
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
            <span className="w-11 shrink-0 truncate text-bf-text-secondary">{def.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-bf-2xs text-bf-text-muted" title={`Undo step ${u.step.id} (${u.step.op}) for ${def.name} only`}>
              #{u.step.id} · {u.revert} vx
              {u.kept ? <span className="text-bf-text-secondary"> · keeps {u.kept}</span> : null}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 className="h-3 w-3" />}
              title={u.kept ? `Keeps ${u.kept} voxels a later step changed (step 37 erased them)` : 'No later step touched these voxels'}
            >
              Undo
            </Button>
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
      <span className="text-bf-text-secondary">
        journal written {JOURNAL.writtenAgoS} s ago · step {JOURNAL.step}
      </span>
      <span title={JOURNAL.path}>
        {JOURNAL.sizeMb} MB of {JOURNAL.budgetMb} MB · keeps ≥ {JOURNAL.minDepth} steps
      </span>
      <span>
        last save {JOURNAL.lastSave.time} · step {JOURNAL.lastSave.step} · {JOURNAL.step - JOURNAL.lastSave.step} steps since
      </span>
    </section>
  );
}

function HistoryDock() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bf-bg-panel" data-testid="history-dock">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-bf-border-subtle px-2">
        <Tabs
          aria-label="Bottom dock"
          value="history"
          onValueChange={() => undefined}
          items={[
            { value: 'history', label: 'History' },
            { value: 'stats', label: 'Label statistics' },
          ]}
        />
        <span className="ml-auto font-mono text-bf-2xs text-bf-text-muted">38 steps · 1 kept branch</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <HistoryTable />
        <div className="flex w-[300px] shrink-0 flex-col gap-3 border-l border-bf-border-subtle px-3 py-2">
          <PerLabelUndo />
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
          <StatusItem label="History" value="38 steps · journal 4 s ago" />
        </>
      }
      rail={<ToolRail state="tracing" />}
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" status="17 steps unsaved · journal 4 s ago" />
          <StepCard state="tracing" />
          <LabelsSection state="tracing" hover={null} />
        </InspectorFrame>
      }
    >
      <TraceGrid
        dockHeight={292}
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
