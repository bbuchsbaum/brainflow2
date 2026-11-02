import React, { useCallback, useRef, useState } from 'react';
import { Button, Tabs } from '@/components/ui/bf';
import { copyLensList, selectBidsModel, useBidsModel, useBidsStore, type BidsActiveView } from '@/stores/bidsStore';
import {
  buildCubidsTable,
  buildDataDescriptor,
  type BidsLensMode,
} from '@/stores/bidsModel';
import { copyToClipboard } from '@/utils/copyToClipboard';
import { cn } from '@/utils/cn';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function LensAction({
  on,
  label,
  onClick,
}: {
  on?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-full shrink-0 cursor-pointer items-center border-l border-bf-border px-[7px]',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent',
        on ? 'bg-bf-bg-selected text-bf-text-primary' : 'text-bf-text-muted hover:text-bf-text-primary',
      )}
    >
      {label}
    </button>
  );
}

function LensChip() {
  const model = useBidsModel();
  const lens = model.lens.lens;
  const mode = model.lens.mode;
  const saved = useBidsStore((state) => state.savedLenses.some((item) => item.id === lens?.id));
  const setLens = useBidsStore((state) => state.setLens);
  const setLensMode = useBidsStore((state) => state.setLensMode);
  const saveLens = useBidsStore((state) => state.saveLens);
  const [naming, setNaming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  if (!lens) {
    return (
      <span className="min-w-0 truncate text-bf-xs text-bf-text-faint">
        No lens. Click a claim or finding, or press{' '}
        <kbd className="rounded-bf-xs border border-bf-border px-1 font-mono text-bf-2xs text-bf-text-muted">⌘K</kbd>
      </span>
    );
  }
  const setMode = (next: BidsLensMode) => () => setLensMode(next);
  return (
    <span
      data-testid="bids-lens-chip"
      className="inline-flex h-[22px] min-w-0 max-w-full items-center overflow-hidden rounded-bf-xs border border-bf-border-strong text-bf-xs"
    >
      <span className="min-w-0 truncate px-[7px] leading-[20px] text-bf-text-primary" title={lens.label}>
        {lens.label} · {plural(model.lens.participants, 'participant')}
      </span>
      <LensAction label="highlight" on={mode === 'highlight'} onClick={setMode('highlight')} />
      <LensAction label="only" on={mode === 'only'} onClick={setMode('only')} />
      {naming ? (
        <form
          className="flex h-full items-center border-l border-bf-border"
          onSubmit={(event) => {
            event.preventDefault();
            saveLens(nameRef.current?.value);
            setNaming(false);
          }}
        >
          <input
            ref={nameRef}
            autoFocus
            aria-label="Lens name"
            defaultValue={lens.label}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNaming(false);
            }}
            onBlur={() => setNaming(false)}
            className="h-full w-44 bg-bf-bg-input px-[7px] text-bf-xs text-bf-text-primary outline-none"
          />
        </form>
      ) : (
        <LensAction
          label={saved ? 'saved' : 'save'}
          onClick={() => {
            if (!saved) setNaming(true);
          }}
        />
      )}
      <LensAction
        label="copy list"
        onClick={() =>
          copyLensList()
        }
      />
      <button
        type="button"
        aria-label="Clear lens"
        onClick={() => setLens(null)}
        className="flex h-full cursor-pointer items-center border-l border-bf-border px-[7px] text-bf-text-faint hover:text-bf-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent"
      >
        ✕
      </button>
    </span>
  );
}

// Images joins these, with the 2 key, when the contact sheet exists.
const VIEW_TABS = [{ value: 'coverage', label: 'Coverage', testId: 'bids-view-coverage' }];

export function BidsViewBar() {
  const activeView = useBidsStore((state) => state.activeView);
  const setActiveView = useBidsStore((state) => state.setActiveView);
  const scanning = useBidsStore((state) => state.scanStatus === 'scanning');
  const paused = useBidsStore(
    (state) => state.scanStatus === 'ready' && state.index?.complete === false,
  );
  const hasVariants = useBidsStore((state) => (state.index?.variants.length ?? 0) > 0);
  const lensOn = useBidsStore((state) => state.lens !== null);

  const copySummary = useCallback(() => {
    void copyToClipboard(buildDataDescriptor(selectBidsModel(useBidsStore.getState())), 'Summary');
  }, []);
  const copyCubids = useCallback(() => {
    void copyToClipboard(buildCubidsTable(selectBidsModel(useBidsStore.getState())), 'CuBIDS table');
  }, []);
  const pause = useCallback(() => void useBidsStore.getState().cancelScan(), []);
  const resume = useCallback(() => {
    const { datasetPath, scanDataset } = useBidsStore.getState();
    if (datasetPath) void scanDataset(datasetPath);
  }, []);

  return (
    <div className="shrink-0 border-b border-bf-border-subtle">
      <div className="flex h-[34px] items-center gap-3 px-3">
        <div className="shrink-0">
          <Tabs
            idBase="bids-view"
            items={VIEW_TABS}
            value={activeView}
            onValueChange={(view) => setActiveView(view as BidsActiveView)}
            aria-label="BIDS views"
          />
        </div>
        {lensOn ? null : <LensChip />}
        <span className="ml-auto" />
        {scanning && (
          <Button variant="secondary" size="sm" onClick={pause}>
            Pause scan
          </Button>
        )}
        {paused && (
          <Button variant="secondary" size="sm" onClick={resume}>
            Resume scan
          </Button>
        )}
        {!scanning && (
          <Button variant="ghost" size="sm" onClick={copySummary}>
            Copy summary
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={copyCubids} disabled={scanning && !hasVariants}>
          Copy CuBIDS table
        </Button>
      </div>
      {/* The lens has a row of its own, so its actions never squeeze the view names. */}
      {lensOn ? (
        <div className="flex min-w-0 items-center px-3 pb-1.5">
          <LensChip />
        </div>
      ) : null}
    </div>
  );
}
