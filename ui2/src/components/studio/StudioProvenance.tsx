import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, KeyValue } from '@/components/ui/bf';
import { getEventBus } from '@/events/EventBus';
import { getConfirmationService } from '@/services/ConfirmationService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioFieldExpressionSummary,
  StudioMaterializationStatus,
  StudioMemberSummary,
} from '@/types/studio';

export interface StudioProvenanceProps {
  activeSet: SpatialFieldSetSummary | null;
  activeMemberId: string | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  scopeCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
  activeArtifact: StudioArtifactSummary | null;
  materialization: StudioMaterializationStatus;
  /** The active lens's own plumbing (Population's Refresh images): a portal slot. */
  lensSlotRef?: (element: HTMLDivElement | null) => void;
  /** Recovery for moved sources ("Sources moved?"). */
  relocate?: ReactNode;
}

/** How the shown image was obtained, in words. */
function studioCacheLabel(artifact: StudioArtifactSummary | null): string {
  switch (artifact?.cacheStatus) {
    case 'source':
      return 'Read from the image file';
    case 'hit':
      return 'Reused from cache';
    case 'miss':
      return 'Computed';
    case 'stale':
      return 'Recomputed (the cached copy was out of date)';
    case 'forced':
      return 'Recomputed';
    case 'synthetic':
      return 'Example image';
    case 'failed':
      return 'Could not be computed';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Unknown';
  }
}

async function copyText(text: string | null, label: string) {
  if (!text || !navigator.clipboard?.writeText) {
    getEventBus().emit('ui.notification', {
      type: 'warning',
      message: `${label} is not available to copy.`,
    });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    getEventBus().emit('ui.notification', {
      type: 'success',
      message: `${label} copied to clipboard.`,
    });
  } catch {
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: `Failed to copy ${label.toLowerCase()}.`,
    });
  }
}

/** The JSON record of the shown artifact and the selection it was made in. */
function studioProvenanceJson({
  activeSet,
  activeMemberId,
  compareCohort,
  scopeCohort,
  activeExpression,
  activeArtifact,
}: Pick<
  StudioProvenanceProps,
  | 'activeSet'
  | 'activeMemberId'
  | 'compareCohort'
  | 'scopeCohort'
  | 'activeExpression'
  | 'activeArtifact'
>): string | null {
  return activeArtifact
    ? JSON.stringify(
        {
          artifact: activeArtifact,
          setId: activeSet?.id ?? null,
          setName: activeSet?.name ?? null,
          activeMemberId,
          compareCohortId: activeArtifact.cohortId ?? compareCohort?.id ?? null,
          compareCohortLabel: activeArtifact.cohortLabel ?? compareCohort?.label ?? null,
          compareCohortOriginKind:
            activeArtifact.cohortOriginKind ?? compareCohort?.originKind ?? null,
          compareCohortOriginLabel:
            activeArtifact.cohortOriginLabel ?? compareCohort?.originLabel ?? null,
          scopeCohortId: scopeCohort?.id ?? null,
          scopeCohortLabel: scopeCohort?.label ?? null,
          scopeCohortOriginKind: scopeCohort?.originKind ?? null,
          scopeCohortOriginLabel: scopeCohort?.originLabel ?? null,
          activeExpressionId: activeExpression?.id ?? null,
          activeExpressionRecipe: activeExpression?.recipe ?? null,
        },
        null,
        2,
      )
    : null;
}

/**
 * The Studio's provenance and recipe plumbing in one place, a disclosure in
 * the ⋯ menu's Data part ("Provenance…"): how the shown image was computed
 * and cached, where its provenance is recorded, the copy and save actions
 * that were the Inspector's "Actions", the lens's own refresh, and recovery
 * for sources that moved. Nothing here is needed to read the maps.
 */
export function StudioProvenance(props: StudioProvenanceProps) {
  const {
    activeSet,
    activeMemberId,
    activeMember,
    compareCohort,
    scopeCohort,
    activeExpression,
    activeArtifact,
    materialization,
    lensSlotRef,
    relocate,
  } = props;
  const saveRecipeSnapshot = useSetStudioStore((state) => state.saveRecipeSnapshot);
  const recipe = activeArtifact?.recipe ?? activeExpression?.recipe ?? null;
  const sourcePath = activeArtifact?.sourcePath ?? activeMember?.sourcePath ?? null;
  const provenancePath = activeArtifact?.provenancePath ?? null;
  const provenanceJson = studioProvenanceJson(props);

  const saveRecipe = async () => {
    if (!activeArtifact || !provenanceJson) {
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: 'No active artifact is available to save as a recipe.',
      });
      return;
    }
    const requestedTitle = (
      await getConfirmationService().prompt({
        title: 'Save recipe',
        message: 'Save the current Studio recipe as:',
        defaultValue: activeArtifact.title,
        confirmLabel: 'Save',
      })
    )?.trim();
    if (requestedTitle === '') {
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: 'Saved recipe title cannot be empty.',
      });
      return;
    }
    const recipeTitle = requestedTitle || activeArtifact.title;
    saveRecipeSnapshot({
      title: recipeTitle,
      subtitle: activeArtifact.subtitle,
      artifact: activeArtifact,
      scopeCohortLabel: scopeCohort?.label ?? null,
      scopeCohortOriginKind: scopeCohort?.originKind ?? null,
      scopeCohortOriginLabel: scopeCohort?.originLabel ?? null,
      selectionSnapshot: {
        activeLens: activeArtifact.lens,
        activeMemberId,
        compareCohortId: activeArtifact.cohortId ?? compareCohort?.id ?? null,
        activeScopeCohortId: scopeCohort?.id ?? null,
        activeExpressionId: activeExpression?.id ?? null,
      },
      provenanceJson,
    });
    getEventBus().emit('ui.notification', {
      type: 'success',
      message: `Saved recipe snapshot for ${recipeTitle}.`,
    });
  };

  const actions: { label: string; run: () => void; available: boolean }[] = [
    { label: 'Copy recipe', run: () => void copyText(recipe, 'Recipe'), available: !!recipe },
    {
      label: 'Copy path',
      run: () => void copyText(sourcePath, 'Source path'),
      available: !!sourcePath,
    },
    {
      label: 'Copy provenance path',
      run: () => void copyText(provenancePath, 'Provenance path'),
      available: !!provenancePath,
    },
    {
      label: 'Copy JSON',
      run: () => void copyText(provenanceJson, 'Provenance JSON'),
      available: !!provenanceJson,
    },
    { label: 'Save recipe', run: () => void saveRecipe(), available: !!provenanceJson },
  ];

  return (
    // App disclosure grammar: chevron right = closed, down = open.
    <details className="group/provenance text-bf-sm" data-testid="studio-provenance">
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 -rotate-90 transition-transform group-open/provenance:rotate-0"
        />
        Provenance…
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <KeyValue
          layout="rows"
          items={[
            { key: 'recipe', label: 'Computed as', value: recipe ?? 'Not recorded', wrap: true },
            // The full path of the shown file (the Inspector shows its name).
            { key: 'source', label: 'Source', value: sourcePath ?? 'No file', wrap: true },
            { key: 'cache', label: 'Cache', value: studioCacheLabel(activeArtifact), mono: false },
            {
              key: 'provenance',
              label: 'Provenance',
              value: provenancePath ?? 'None recorded',
              wrap: true,
            },
            ...(activeSet
              ? [
                  {
                    key: 'set-cache',
                    label: 'Set cache',
                    value: `warm ${materialization.warm} · preview ${materialization.preview} · pending ${materialization.pending}`,
                  },
                ]
              : []),
          ]}
        />
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="link"
              className="min-h-6"
              size="sm"
              disabled={!action.available}
              title={action.available ? undefined : 'Nothing recorded for the shown image'}
              onClick={action.run}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <div ref={lensSlotRef} className="flex flex-wrap items-center gap-2 empty:hidden" />
        {relocate}
      </div>
    </details>
  );
}
