import React from 'react';
import type { StudioCohortSummary, StudioLensType } from '@/types/studio';

interface LensOption {
  id: StudioLensType;
  label: string;
  available: boolean;
  hint?: string;
}

const LENS_OPTIONS: LensOption[] = [
  { id: 'population', label: 'Population', available: true },
  { id: 'deck', label: 'Deck', available: true },
  { id: 'compare', label: 'Compare', available: true },
];

interface StudioLensSwitcherProps {
  activeLens: StudioLensType;
  populationOnly?: boolean;
  onSelectLens: (lens: StudioLensType) => void;
  compareCohort: StudioCohortSummary | null;
  cohorts: StudioCohortSummary[];
  onSelectCompareCohort: (cohortId: string | null) => void;
}

export function StudioLensSwitcher({
  activeLens,
  populationOnly = false,
  onSelectLens,
  compareCohort,
  cohorts,
  onSelectCompareCohort,
}: StudioLensSwitcherProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        Lens
      </span>
      <div
        role="tablist"
        aria-label="Set Studio lens"
        className="inline-flex items-center rounded-md border border-border bg-background p-0.5"
      >
        {LENS_OPTIONS.map((option) => {
          const selected = activeLens === option.id;
          const disabled = !option.available || (populationOnly && option.id !== 'population');
          return (
            <button
              key={option.id}
              role="tab"
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              type="button"
              disabled={disabled}
              title={
                populationOnly && disabled
                  ? 'Saved inputs are explored in Population; import a study to use this view.'
                  : undefined
              }
              onClick={() => !disabled && onSelectLens(option.id)}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs transition-colors ${
                selected
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : disabled
                    ? 'text-muted-foreground/60'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground'
              }`}
            >
              {option.label}
              {option.hint ? (
                <span className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeLens === 'compare' ? (
        <>
          <span className="h-4 w-px bg-border" aria-hidden />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em]">
              Compare mode
            </span>
            <select
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground"
              value={compareCohort?.id ?? ''}
              onChange={(event) => onSelectCompareCohort(event.target.value || null)}
            >
              <option value="">Current vs … (select cohort)</option>
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {`Current vs ${cohort.label} (n=${cohort.memberCount})`}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}
