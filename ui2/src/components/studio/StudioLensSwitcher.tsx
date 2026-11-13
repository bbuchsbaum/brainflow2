import React from 'react';
import { SegmentedControl, Select } from '@/components/ui/bf';
import type { StudioCohortSummary, StudioLensType } from '@/types/studio';

interface LensOption {
  id: StudioLensType;
  label: string;
  available: boolean;
  hint?: string;
}

/**
 * The lenses one chooses between: the whole set, or one subject against the
 * set's mean ("Subject vs mean": current, mean, residual, z; it was
 * "Compare", which collided with Compare and test and the app's Compare
 * mode). The single-subject view (the `deck` lens) is not a choice here: it
 * is opened from a subject ("Open in Deck" in the Inspector or the Subjects
 * panel) and shows as a third, selected segment while it is open, so the
 * way back is the Population segment beside it.
 */
const LENS_OPTIONS: LensOption[] = [
  { id: 'population', label: 'Population', available: true },
  { id: 'compare', label: 'Subject vs mean', available: true },
];

const SUBJECT_OPTION: LensOption = { id: 'deck', label: 'Subject', available: true };

/** What the lens switch offers for the active lens. */
function studioLensOptions(activeLens: StudioLensType): LensOption[] {
  return activeLens === 'deck' ? [...LENS_OPTIONS, SUBJECT_OPTION] : LENS_OPTIONS;
}

interface StudioLensSwitcherProps {
  /** Render inline in a shared toolbar row: no frame of its own, no wrap. */
  bare?: boolean;
  /**
   * The lens switch alone, unlabelled: the Studio toolbar's first row, where
   * the Compare lens's "Compare with" select sits on the row below.
   */
  switchOnly?: boolean;
  activeLens: StudioLensType;
  populationOnly?: boolean;
  onSelectLens: (lens: StudioLensType) => void;
  compareCohort: StudioCohortSummary | null;
  cohorts: StudioCohortSummary[];
  onSelectCompareCohort: (cohortId: string | null) => void;
}

export function StudioLensSwitcher({
  bare = false,
  switchOnly = false,
  activeLens,
  populationOnly = false,
  onSelectLens,
  compareCohort,
  cohorts,
  onSelectCompareCohort,
}: StudioLensSwitcherProps) {
  return (
    <div
      className={
        switchOnly
          ? 'flex min-w-0 shrink-0 items-center'
          : bare
          ? 'flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1'
          : 'flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card px-3 py-1.5'
      }
    >
      {switchOnly ? null : (
        <span className="text-bf-xs font-medium text-muted-foreground">Lens</span>
      )}
      <SegmentedControl
        aria-label="Set studio lens"
        options={studioLensOptions(activeLens).map((option) => {
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
                : option.id === 'compare'
                  ? 'One subject beside the mean: current, mean, residual and z'
                  : option.id === 'deck'
                    ? 'One subject on its own; Population returns to the set'
                    : undefined,
          };
        })}
        value={activeLens}
        onValueChange={(value) => onSelectLens(value as StudioLensType)}
        hideWhenSingle={false}
      />

      {activeLens === 'compare' && !switchOnly ? (
        <StudioCompareSelect
          hideLabel={bare}
          compareCohort={compareCohort}
          cohorts={cohorts}
          onSelectCompareCohort={onSelectCompareCohort}
        />
      ) : null}
    </div>
  );
}

/**
 * What the Compare lens compares the current subject with. In the shared
 * toolbar it sits on the lens's own row (row 2), not beside the lens switch.
 */
export function StudioCompareSelect({
  hideLabel = false,
  compareCohort,
  cohorts,
  onSelectCompareCohort,
}: Pick<StudioLensSwitcherProps, 'compareCohort' | 'cohorts' | 'onSelectCompareCohort'> & {
  hideLabel?: boolean;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-bf-sm text-muted-foreground">
      <span className={`text-bf-xs font-medium ${hideLabel ? 'sr-only' : ''}`}>Compare with</span>
      <Select
        className="w-auto min-w-0 max-w-[16rem]"
        value={compareCohort?.id ?? ''}
        onValueChange={(value) => onSelectCompareCohort(value || null)}
      >
        <option value="">Current vs … (choose a group)</option>
        {cohorts.map((cohort) => (
          <option key={cohort.id} value={cohort.id}>
            {`Current vs ${cohort.label} (n=${cohort.memberCount})`}
          </option>
        ))}
      </Select>
    </label>
  );
}

