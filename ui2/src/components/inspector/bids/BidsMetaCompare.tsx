import React, { useMemo } from 'react';
import type { BidsBrowserIndex, BidsRunRecord } from '@brainflow/api';
import { compareRunMetadata, sourceFileName } from '@/stores/bidsInspect';
import { cn } from '@/utils/cn';

/** Effective metadata against the series' modal values. Changed is bright, modal is faint. */
export function BidsMetaCompare({ run, index }: { run: BidsRunRecord; index: BidsBrowserIndex }) {
  const comparison = useMemo(() => {
    const modal = index.series_modal.find((entry) => entry.series === run.series);
    return compareRunMetadata(run, modal);
  }, [run, index.series_modal]);

  if (run.sidecar.length === 0) {
    return <p className="m-0 text-bf-xs text-bf-text-muted">No sidecar or header values for this run.</p>;
  }
  const { rows, identicalHidden, inherited, hasModal } = comparison;
  return (
    <div className="flex flex-col gap-1">
      {!hasModal && (
        <p className="m-0 text-bf-xs text-bf-text-muted">No modal values for this series yet.</p>
      )}
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-2.5 gap-y-0.5 font-mono text-bf-xs"
        role="table"
        aria-label="Effective metadata against modal values"
      >
        {rows.map((row) => (
          <div key={row.key} role="row" className="contents" data-changed={row.changed}>
            <span role="cell" className="truncate text-bf-text-muted" title={row.label}>
              {row.label}
            </span>
            <span
              role="cell"
              className={cn(
                'max-w-[96px] truncate text-right',
                row.changed ? 'font-medium text-bf-text-primary' : 'text-bf-text-secondary',
              )}
              title={row.value}
            >
              {row.value}
            </span>
            <span role="cell" className="max-w-[72px] truncate text-bf-text-faint" title={row.modal}>
              {row.modal}
            </span>
            <span role="cell" className="text-right text-bf-2xs text-bf-text-faint" title={row.sourceFile}>
              {row.sourceLabel}
            </span>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="m-0 text-bf-xs text-bf-text-muted">Every value matches the modal group.</p>
      )}
      <p className="m-0 font-mono text-bf-2xs text-bf-text-faint">
        run = this run's sidecar
        {inherited.length
          ? ` · dataset = ${inherited.map(sourceFileName).join(', ')}, inherited`
          : ''}
        {identicalHidden > 0
          ? ` · ${identicalHidden} more ${identicalHidden === 1 ? 'key' : 'keys'} identical`
          : ''}
      </p>
    </div>
  );
}
