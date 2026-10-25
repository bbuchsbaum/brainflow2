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
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card px-3 py-2">
      <span className="text-bf-xs font-medium text-muted-foreground">
        Lens
      </span>
      <div
        role="tablist"
        aria-label="Set Studio lens"
        className="inline-flex items-stretch rounded-sm border border-border bg-background"
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
              className={`relative inline-flex items-center gap-1.5 border-r border-bf-border-subtle px-3 py-1 text-bf-sm transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                selected
                  ? 'bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]'
                  : disabled
                    ? 'text-bf-text-faint'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {option.label}
              {option.hint ? (
                <span className="text-bf-2xs text-muted-foreground">
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
          <label className="flex items-center gap-2 text-bf-sm text-muted-foreground">
            <span className="text-bf-xs font-medium">
              Compare mode
            </span>
            <select
              className="rounded-sm border border-border bg-background px-2.5 py-1 text-bf-sm text-foreground"
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
