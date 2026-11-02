import React, { useEffect } from 'react';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import type { BidsModel } from '@/stores/bidsModel';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const count = new Intl.NumberFormat('en-US');
const plural = (n: number, word: string) => `${count.format(n)} ${word}${n === 1 ? '' : 's'}`;

/** Closing the last BIDS tab stops its scan: nothing shows the result any more. */
export function useBidsScanOwnership(): void {
  useEffect(() => {
    const open = (workspaces: ReadonlyMap<string, { type: string }>) =>
      [...workspaces.values()].some((workspace) => workspace.type === 'bids-explorer');
    return useWorkspaceStore.subscribe((state, previous) => {
      if (open(previous.workspaces) && !open(state.workspaces)) {
        void useBidsStore
          .getState()
          .cancelScan()
          .catch(() => undefined);
      }
    });
  }, []);
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** The status line, from the model's one status record. */
export function bidsStatusParts(model: BidsModel): {
  left: string[];
  validator: Array<{ text: string; tone: 'error' | 'warning' | null }>;
  read: string;
} {
  const { status } = model;
  const soFar = status.soFar ? ' so far' : '';
  const head = status.bidsVersion ? `BIDS ${status.bidsVersion}` : 'BIDS';
  const versions = status.datasetVersion ? `${head} · dataset v${status.datasetVersion}` : head;
  const left = [
    versions,
    `${plural(status.participants, 'participant')} · ${plural(status.filesRead, 'file')} · ${formatBytes(status.sizeBytes)}${soFar}`,
    `Findings ${count.format(status.findings)}${soFar}`,
    `Excluded ${plural(status.excludedRuns, 'run')}`,
  ];
  // Rule 7: the validator's count is never mixed with Brainflow's checks.
  const checkErrors = status.errors - status.validatorErrors;
  const checkWarnings = status.warnings - status.validatorWarnings;
  const counted = (n: number, word: 'error' | 'warning') => ({
    text: plural(n, word),
    tone: n > 0 ? word : null,
  });
  const validator = [
    { text: 'validator', tone: null },
    counted(status.validatorErrors, 'error'),
    counted(status.validatorWarnings, 'warning'),
    { text: 'checks', tone: null },
    counted(checkErrors, 'error'),
    counted(checkWarnings, 'warning'),
  ];
  const read = `read ${count.format(status.filesRead)} of ${count.format(status.filesTotal)} files`;
  return { left, validator, read };
}

function statusNodes(model: BidsModel): [React.ReactNode, React.ReactNode] {
  const { left, validator, read } = bidsStatusParts(model);
  return [
    <span key="left" className="inline-flex min-w-0 gap-4 truncate text-bf-xs text-bf-text-muted">
      {left.map((part) => (
        <span key={part} className="whitespace-nowrap">
          {part}
        </span>
      ))}
    </span>,
    <span key="right" className="whitespace-nowrap text-bf-xs text-bf-text-muted">
      {validator.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && i !== 1 && i !== 4 ? ' · ' : ' '}
          <span
            className={
              part.tone === 'error' ? 'text-bf-danger' : part.tone === 'warning' ? 'text-bf-warning' : undefined
            }
          >
            {part.text}
          </span>
        </React.Fragment>
      ))}
      {' · '}
      {read}
    </span>,
  ];
}

/**
 * The status bar while the BIDS browser is in front. It writes two slots of its
 * own, so the crosshair readout, its Go To and everything other writers keep
 * updating stay as they were; leaving removes the two slots.
 */
export function useBidsStatusBridge(workspaceType: string | null): void {
  const active = workspaceType === 'bids-explorer';
  useEffect(() => {
    if (!active) return;
    let last: BidsModel | null = null;
    const write = () => {
      const model = selectBidsModel(useBidsStore.getState());
      if (model === last) return;
      last = model;
      if (!model.index) {
        useStatusBarStore.getState().setBatch([
          ['workspaceStatus', 'BIDS'],
          ['workspaceStatusRight', null],
        ]);
        return;
      }
      const [left, right] = statusNodes(model);
      useStatusBarStore.getState().setBatch([
        ['workspaceStatus', left],
        ['workspaceStatusRight', right],
      ]);
    };
    write();
    const stop = useBidsStore.subscribe(write);
    return () => {
      stop();
      const { removeValue } = useStatusBarStore.getState();
      removeValue('workspaceStatus');
      removeValue('workspaceStatusRight');
    };
  }, [active]);
}
