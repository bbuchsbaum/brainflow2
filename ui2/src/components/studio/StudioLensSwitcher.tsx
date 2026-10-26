import React from 'react';
import { SegmentedControl, Select } from '@/components/ui/bf';
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
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card px-3 py-1.5">
      <span className="text-bf-xs font-medium text-muted-foreground">
        Lens
      </span>
      <SegmentedControl
        aria-label="Set Studio lens"
        options={LENS_OPTIONS.map((option) => {
          const disabled = !option.available || (populationOnly && option.id !== 'population');
          return {
            value: option.id,
            label: option.hint ? (
              <>
                {option.label}
                <span className="text-bf-2xs text-muted-foreground">{option.hint}</span>
              </>
            ) : (
              option.label
            ),
            'aria-label': option.hint ? option.label : undefined,
            disabled,
            title:
              populationOnly && disabled
                ? 'Saved inputs are explored in Population; import a study to use this view.'
                : undefined,
          };
        })}
        value={activeLens}
        onValueChange={(value) => onSelectLens(value as StudioLensType)}
        hideWhenSingle={false}
      />

      {activeLens === 'compare' ? (
        <>
          <span className="h-4 w-px bg-border" aria-hidden />
          <label className="flex items-center gap-2 text-bf-sm text-muted-foreground">
            <span className="text-bf-xs font-medium">
              Compare mode
            </span>
            <Select
              className="w-auto"
              value={compareCohort?.id ?? ''}
              onValueChange={(value) => onSelectCompareCohort(value || null)}
            >
              <option value="">Current vs … (select cohort)</option>
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {`Current vs ${cohort.label} (n=${cohort.memberCount})`}
                </option>
              ))}
            </Select>
          </label>
        </>
      ) : null}
    </div>
  );
}
