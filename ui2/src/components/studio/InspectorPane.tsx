import React from 'react';
import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { getEventBus } from '@/events/EventBus';
import { getConfirmationService } from '@/services/ConfirmationService';
import { StudioPane } from './StudioPane';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioFieldExpressionSummary,
  StudioMaterializationStatus,
  StudioMemberSummary,
  StudioSavedRecipeSummary,
} from '@/types/studio';

interface InspectorPaneProps {
  activeSet: SpatialFieldSetSummary | null;
  activeMemberId: string | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  scopeCohort?: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
  materialization: StudioMaterializationStatus;
  activeArtifact: StudioArtifactSummary | null;
  artifactHistory: StudioArtifactSummary[];
  savedRecipes: StudioSavedRecipeSummary[];
  onSelectArtifact: (artifact: StudioArtifactSummary) => void;
  onOpenArtifact: (artifact: StudioArtifactSummary) => void;
  onRestoreArtifact: (artifact: StudioArtifactSummary) => void;
  onSaveRecipeSnapshot: (recipe: Omit<StudioSavedRecipeSummary, 'id' | 'savedAtMs'>) => string;
  onRestoreRecipe: (recipe: StudioSavedRecipeSummary) => void;
  onRenameRecipe: (recipe: StudioSavedRecipeSummary) => void;
  onDeleteRecipe: (recipe: StudioSavedRecipeSummary) => void;
}

export function InspectorPane({
  activeSet,
  activeMemberId,
  activeMember,
  compareCohort,
  scopeCohort,
  activeExpression,
  materialization,
  activeArtifact,
  artifactHistory,
  savedRecipes,
  onSelectArtifact,
  onOpenArtifact,
  onRestoreArtifact,
  onSaveRecipeSnapshot,
  onRestoreRecipe,
  onRenameRecipe,
  onDeleteRecipe,
}: InspectorPaneProps) {
  if (!activeSet && !activeArtifact && !activeMemberId) {
    return (
      <StudioPane title="Details" showHeader={false}>
        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <div className="text-sm font-medium text-foreground">Nothing selected</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            Select a member or compare result to inspect it here.
          </div>
        </div>
      </StudioPane>
    );
  }

  const formatTimestamp = (timestampMs: number): string => {
    if (!timestampMs) {
      return 'Not captured yet';
    }
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const artifactBindingLabel = (artifact: StudioArtifactSummary | null): string => {
    if (!artifact) {
      return 'No active artifact';
    }
    if (artifact.sourcePath) {
      const parts = artifact.sourcePath.split(/[\\/]/);
      return parts[parts.length - 1] || artifact.sourcePath;
    }
    return artifact.materializationKey ?? 'No binding key';
  };

  const materializedLabel = (artifact: StudioArtifactSummary | null): string => {
    if (!artifact) {
      return 'Not materialized';
    }
    if (artifact.materializedAtMs) {
      return formatTimestamp(artifact.materializedAtMs);
    }
    return artifact.bindingKind === 'derived_field' ? 'Pending or not cached' : 'Source-backed';
  };

  const copyText = async (text: string | null, label: string) => {
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
  };

  const provenanceJson = activeArtifact
    ? JSON.stringify(
        {
          artifact: activeArtifact,
          setId: activeSet?.id ?? null,
          setName: activeSet?.name ?? null,
          activeMemberId,
          compareCohortId: activeArtifact.cohortId ?? compareCohort?.id ?? null,
          compareCohortLabel: activeArtifact.cohortLabel ?? compareCohort?.label ?? null,
          compareCohortOriginKind: activeArtifact.cohortOriginKind ?? compareCohort?.originKind ?? null,
          compareCohortOriginLabel: activeArtifact.cohortOriginLabel ?? compareCohort?.originLabel ?? null,
          scopeCohortId: scopeCohort?.id ?? null,
          scopeCohortLabel: scopeCohort?.label ?? null,
          scopeCohortOriginKind: scopeCohort?.originKind ?? null,
          scopeCohortOriginLabel: scopeCohort?.originLabel ?? null,
          activeExpressionId: activeExpression?.id ?? null,
          activeExpressionRecipe: activeExpression?.recipe ?? null,
        },
        null,
        2
      )
    : null;
  const activeCompareOrigin =
    activeArtifact?.cohortLabel || activeArtifact?.cohortOriginKind || activeArtifact?.cohortOriginLabel
      ? formatCapturedCohortOrigin(
          activeArtifact?.cohortLabel ?? null,
          activeArtifact?.cohortOriginKind ?? null,
          activeArtifact?.cohortOriginLabel ?? null
        )
      : formatCohortOrigin(compareCohort);
  const activeCompareLabel = activeArtifact?.cohortLabel ?? compareCohort?.label ?? 'None';
  const saveCurrentRecipe = async () => {
    if (!activeArtifact || !provenanceJson) {
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: 'No active artifact is available to save as a recipe.',
      });
      return;
    }

    const requestedTitle = (
      await getConfirmationService().prompt({
        title: 'Save Recipe',
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
    onSaveRecipeSnapshot({
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

  return (
    <StudioPane
      title="Details"
      showHeader={false}
    >
      <div className="space-y-4 text-sm text-foreground">
        {!activeArtifact && !activeMemberId ? (
          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <div className="text-sm font-medium text-foreground">Nothing selected</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Select a member or compare result to inspect it here.
            </div>
          </div>
        ) : (
          <div className="space-y-4 divide-y divide-border rounded-lg border border-border bg-background px-3 py-3">
            <DetailSection title="Current">
              <InfoRow label="Active" value={activeArtifact?.title ?? activeMemberId ?? 'No member selected'} />
              <InfoRow label="Source" value={activeArtifact?.sourcePath ?? activeMember?.sourcePath ?? 'No bound file path'} />
              <InfoRow label="Expression" value={activeArtifact?.recipe ?? activeExpression?.recipe ?? 'Deck(member)'} />
              <InfoRow label="Compare" value={activeCompareLabel} />
              <InfoRow label="Scope" value={scopeCohort?.label ?? 'All members'} />
            </DetailSection>

            {activeSet ? (
              <DetailSection title="Dataset">
                <InfoRow label="Support" value={activeSet.supportLabel} />
                <InfoRow label="Alignment" value={activeSet.alignmentClass} />
                <InfoRow
                  label="Import"
                  value={`${activeSet.ingestAudit.join.matchedRows} matched · ${activeSet.ingestAudit.join.unmatchedRows} unmatched`}
                />
                <InfoRow
                  label="Cache"
                  value={`warm ${materialization.warm} · preview ${materialization.preview} · pending ${materialization.pending}`}
                />
              </DetailSection>
            ) : null}

            <DetailSection title="Actions">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void copyText(activeArtifact?.recipe ?? activeExpression?.recipe ?? null, 'Recipe');
                  }}
                >
                  Copy Recipe
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void copyText(activeArtifact?.sourcePath ?? activeMember?.sourcePath ?? null, 'Source path');
                  }}
                >
                  Copy Path
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void copyText(provenanceJson, 'Provenance JSON');
                  }}
                >
                  Copy JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void saveCurrentRecipe();
                  }}
                >
                  Save Recipe
                </Button>
              </div>
            </DetailSection>
          </div>
        )}

        <div className="rounded-lg border border-border bg-background p-3">
          <CollapsibleSection title={`Saved recipes (${savedRecipes.length})`} defaultExpanded={false}>
            {savedRecipes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No saved recipes yet.</div>
            ) : (
              <div className="space-y-2">
                {savedRecipes.map((recipe) => (
                  <div key={recipe.id} className="rounded-md border border-border bg-card px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(recipe.artifact)}
                      className="w-full text-left"
                    >
                      <div className="text-xs text-muted-foreground">
                        saved {formatTimestamp(recipe.savedAtMs)}
                      </div>
                      <div className="mt-1 text-sm text-foreground">{recipe.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {recipe.subtitle ?? recipe.artifact.recipe ?? 'No recipe subtitle'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatSavedRecipeSummary(recipe)}
                      </div>
                      {recipe.scopeCohortLabel ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          scope {formatCapturedCohortOrigin(
                            recipe.scopeCohortLabel,
                            recipe.scopeCohortOriginKind,
                            recipe.scopeCohortOriginLabel
                          )}
                        </div>
                      ) : null}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={() => onSelectArtifact(recipe.artifact)}>
                        Inspect
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onRestoreRecipe(recipe)}>
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void copyText(recipe.artifact.recipe, 'Saved recipe');
                        }}
                      >
                        Copy Recipe
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void copyText(recipe.provenanceJson, 'Saved provenance');
                        }}
                      >
                        Copy JSON
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onRenameRecipe(recipe)}>
                        Rename
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDeleteRecipe(recipe)}>
                        Delete
                      </Button>
                      {recipe.artifact.sourcePath ? (
                        <Button variant="ghost" size="sm" onClick={() => onOpenArtifact(recipe.artifact)}>
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <CollapsibleSection title={`Recent artifacts (${artifactHistory.length})`} defaultExpanded={false}>
            {artifactHistory.length === 0 ? (
              <div className="text-xs text-muted-foreground">No artifact history yet.</div>
            ) : (
              <div className="space-y-2">
                {artifactHistory.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={`rounded-md border px-3 py-2 transition-colors ${
                      activeArtifact?.id === artifact.id
                        ? 'border-sky-500/60 bg-sky-500/10'
                        : 'border-border bg-card'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(artifact)}
                      className="w-full text-left"
                    >
                      <div className="text-xs text-muted-foreground">
                        {artifact.lens} {artifact.paneId ? `· ${artifact.paneId}` : ''} · inspected {formatTimestamp(artifact.capturedAtMs)}
                      </div>
                      <div className="mt-1 text-sm text-foreground">{artifact.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {artifactBindingLabel(artifact)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        materialized {materializedLabel(artifact)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        cohort {formatCapturedCohortOrigin(
                          artifact.cohortLabel,
                          artifact.cohortOriginKind,
                          artifact.cohortOriginLabel
                        )}
                      </div>
                    </button>
                    <div className="mt-3 flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => onRestoreArtifact(artifact)}>
                        Restore
                      </Button>
                      {artifact.sourcePath ? (
                        <Button variant="ghost" size="sm" onClick={() => onOpenArtifact(artifact)}>
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>
      </div>
    </StudioPane>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-4 first:pt-0">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function formatCohortOrigin(cohort: StudioCohortSummary | null | undefined): string {
  if (!cohort) {
    return 'None';
  }

  return formatCapturedCohortOrigin(cohort.label, cohort.originKind, cohort.originLabel);
}

function formatCapturedCohortOrigin(
  cohortLabel: string | null | undefined,
  cohortOriginKind: StudioArtifactSummary['cohortOriginKind'] | StudioCohortSummary['originKind'] | null | undefined,
  cohortOriginLabel: string | null | undefined
): string {
  if (!cohortLabel && !cohortOriginKind && !cohortOriginLabel) {
    return 'None';
  }

  const kind =
    cohortOriginKind === 'issue_focus'
      ? 'Issue focus'
      : cohortOriginKind === 'saved_snapshot'
        ? 'Saved snapshot'
        : 'Imported';

  const base = cohortOriginLabel ? `${kind} · ${cohortOriginLabel}` : kind;
  return cohortLabel ? `${cohortLabel} · ${base}` : base;
}

function formatSavedRecipeSummary(recipe: StudioSavedRecipeSummary): string {
  const parts = [
    `lens ${recipe.selectionSnapshot.activeLens}`,
    recipe.artifact.supportLabel ? `support ${recipe.artifact.supportLabel}` : null,
    recipe.artifact.cohortLabel ? `cohort ${recipe.artifact.cohortLabel}` : null,
    recipe.artifact.bindingKind ? `binding ${recipe.artifact.bindingKind}` : null,
    recipe.artifact.status ? `status ${recipe.artifact.status}` : null,
  ].filter(Boolean);

  return parts.join(' · ');
}
