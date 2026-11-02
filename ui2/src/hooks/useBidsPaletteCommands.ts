import { useMemo } from 'react';
import { BIDS_RUNS_TAB } from '@/components/bids/bidsDock';
import type { CommandPaletteCommand } from '@/components/dialogs/CommandPaletteDialog';
import { openDockTab } from '@/components/layout/openDockTab';
import { openRunInViewer } from '@/services/bids/openRunInViewer';
import { copyLensList, selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import {
  buildCubidsTable,
  buildDataDescriptor,
  runLabel,
  type BidsLens,
  type BidsModel,
} from '@/stores/bidsModel';
import { copyToClipboard } from '@/utils/copyToClipboard';

const RUNS = 'Runs';
const PARTICIPANTS = 'Participants';
const FINDINGS = 'Findings';
const LENSES = 'Saved lenses and commands';

const bids = () => useBidsStore.getState();

function setLens(lens: BidsLens) {
  bids().setLens(lens);
}

/** A run hidden by "only" must still be reachable: selection shows the whole matrix. */
function selectRun(runId: string) {
  const state = bids();
  if (!selectBidsModel(state).runPosition.has(runId)) state.setLensMode('highlight');
  state.selectRun(runId);
}

/** Every go-to entry for a model. Built once per open, in section order. */
export function buildBidsPaletteCommands(
  model: BidsModel,
  selectedRunId: string | null,
): CommandPaletteCommand[] {
  const commands: CommandPaletteCommand[] = [];
  for (const facts of model.runs) {
    const { run } = facts;
    commands.push({
      id: `bids.run.${run.id}`,
      title: runLabel(run),
      keywords: [run.id],
      section: RUNS,
      badge: facts.meanFd !== null ? `FD ${facts.meanFd.toFixed(2)}` : undefined,
      run: () => openRunInViewer(run),
      select: () => selectRun(run.id),
    });
  }
  const sessionsOf = new Map<string, Set<string | null>>();
  for (const { run } of model.runs) {
    const own = sessionsOf.get(run.subject) ?? new Set<string | null>();
    own.add(run.session);
    sessionsOf.set(run.subject, own);
  }
  for (const row of model.rows) {
    const sessions = sessionsOf.get(row.subject)?.size ?? 0;
    commands.push({
      id: `bids.participant.${row.subject}`,
      title: row.label,
      subtitle: [
        row.group,
        [row.sex, row.age].filter(Boolean).join(' '),
        `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`,
      ]
        .filter(Boolean)
        .join(' · '),
      section: PARTICIPANTS,
      hint: `lens: ${row.label}`,
      run: () =>
        setLens({
          id: `participant:${row.subject}`,
          label: row.label,
          predicate: { op: 'subjects', ids: [row.subject] },
        }),
    });
  }
  for (const group of model.findings.groups) {
    if (group.id === 'saved' || group.id === 'excluded') continue;
    for (const item of group.items) {
      const { lens } = item;
      if (!lens) continue;
      commands.push({
        id: `bids.finding.${item.id}`,
        title: item.title,
        keywords: [item.entity],
        section: FINDINGS,
        hint: item.entity,
        run: () => setLens(lens),
      });
    }
  }
  const saved = model.findings.groups.find((group) => group.id === 'saved');
  for (const item of saved?.items ?? []) {
    const { lens } = item;
    if (!lens) continue;
    commands.push({
      id: `bids.saved.${item.id}`,
      title: item.title,
      keywords: ['saved', 'lens'],
      section: LENSES,
      hint: 'lens',
      run: () => setLens(lens),
    });
  }
  const selected = selectedRunId ? model.runsById.get(selectedRunId) : undefined;
  const command = (id: string, title: string, run: () => void, hint?: string) =>
    commands.push({ id: `bids.command.${id}`, title, section: LENSES, hint, run });
  if (selected) {
    command('exclude', `Exclude ${runLabel(selected.run)}…`, () => bids().requestAction('exclude'), 'X');
    command('compare', 'Compare with modal', () => bids().requestAction('compare'), 'C');
  }
  command('coverage', 'Go to Coverage', () => bids().setActiveView('coverage'), '1');
  command('runs', 'Go to runs in lens', () => openDockTab(BIDS_RUNS_TAB, { focus: true }));
  command('copy-summary', 'Copy summary', () => {
    void copyToClipboard(buildDataDescriptor(selectBidsModel(bids())), 'Summary');
  });
  command('copy-cubids', 'Copy CuBIDS table', () => {
    void copyToClipboard(buildCubidsTable(selectBidsModel(bids())), 'CuBIDS table');
  });
  if (model.lens.lens) {
    command('copy-lens', 'Copy lens list (TSV)', () => {
      copyLensList();
    });
  }
  return commands;
}

/** Built only while the palette is open in the BIDS browser. */
export function useBidsPaletteCommands(open: boolean, workspaceType: string | null) {
  const active = open && workspaceType === 'bids-explorer';
  return useMemo(() => {
    if (!active) return null;
    const state = useBidsStore.getState();
    return buildBidsPaletteCommands(selectBidsModel(state), state.selectedRunId);
  }, [active]);
}
