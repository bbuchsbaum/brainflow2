/**
 * The generated paragraph at the top of the workspace. Every claim sets the
 * lens; the FD threshold is edited in the sentence. All text comes from the
 * model, and a claim whose data is absent is not written.
 */
import React, { useEffect, useState } from 'react';
import { useBidsModel, useBidsStore } from '@/stores/bidsStore';
import { openDockTab } from '@/components/layout/openDockTab';
import { cn } from '@/utils/cn';
import type { BidsLens, BidsSummarySegment } from '@/stores/bidsModel';
import { BIDS_RUNS_TAB } from './bidsDock';

function Claim({ segment, active }: { segment: Extract<BidsSummarySegment, { kind: 'claim' }>; active: boolean }) {
  const setLens = useBidsStore((state) => state.setLens);
  const toggle = (lens: BidsLens) => {
    setLens(active ? null : lens);
    if (!active) openDockTab(BIDS_RUNS_TAB);
  };
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => toggle(segment.lens)}
      className={cn(
        'cursor-pointer underline decoration-dotted decoration-bf-text-faint underline-offset-[3px]',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent',
        segment.tone === 'error'
          ? 'text-bf-danger'
          : segment.tone === 'warning'
            ? 'text-bf-warning'
            : 'text-bf-text-primary',
        active && 'bg-bf-bg-selected decoration-bf-text-primary shadow-[0_0_0_1px_var(--bf-border-strong)]',
      )}
    >
      {segment.text}
    </button>
  );
}

function ThresholdField() {
  const threshold = useBidsStore((state) => state.fdThreshold);
  const setFdThreshold = useBidsStore((state) => state.setFdThreshold);
  const [draft, setDraft] = useState(String(threshold));
  useEffect(() => setDraft(String(threshold)), [threshold]);

  const commit = () => {
    const value = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(value) && value > 0) setFdThreshold(value);
    else setDraft(String(threshold));
  };

  return (
    <span className="whitespace-nowrap border-b border-bf-text-muted bg-bf-bg-panel-sunken px-0.5 font-mono text-bf-text-primary">
      <input
        aria-label="Mean FD threshold, mm"
        data-testid="bids-fd-threshold"
        value={draft}
        inputMode="decimal"
        size={Math.max(draft.length, 2)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(threshold));
            event.currentTarget.blur();
          }
        }}
        className="w-auto bg-transparent text-center font-mono text-bf-text-primary outline-none"
      />{' '}
      mm
    </span>
  );
}

export function BidsSummary() {
  const model = useBidsModel();
  const lensId = useBidsStore((state) => state.lens?.id ?? null);
  return (
    <div className="shrink-0 border-b border-bf-border-subtle px-4 pt-3 pb-2.5" data-testid="bids-summary">
      <p className="m-0 max-w-[100ch] text-bf-md leading-[1.6] text-bf-text-secondary">
        {model.summary.segments.map((segment, i) => {
          switch (segment.kind) {
            case 'head':
              return (
                <b key={i} className="font-semibold text-bf-text-primary">
                  {segment.text}
                </b>
              );
            case 'text':
              return <React.Fragment key={i}>{segment.text}</React.Fragment>;
            case 'claim':
              return <Claim key={segment.id} segment={segment} active={lensId === segment.id} />;
            case 'threshold':
              return <ThresholdField key="threshold" />;
          }
        })}
      </p>
    </div>
  );
}
