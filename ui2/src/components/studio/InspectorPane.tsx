import React from 'react';
import { Button, KeyValue, Notice, SELECTED, Section } from '@/components/ui/bf';
import { cn } from '@/utils/cn';
import { getEventBus } from '@/events/EventBus';
import { StudioPane } from './StudioPane';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioFieldExpressionSummary,
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
  activeArtifact: StudioArtifactSummary | null;
  artifactHistory: StudioArtifactSummary[];
  savedRecipes: StudioSavedRecipeSummary[];
  onSelectArtifact: (artifact: StudioArtifactSummary) => void;
  onOpenArtifact: (artifact: StudioArtifactSummary) => void;
  onRestoreArtifact: (artifact: StudioArtifactSummary) => void;
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
  activeArtifact,
  artifactHistory,
  savedRecipes,
  onSelectArtifact,
  onOpenArtifact,
  onRestoreArtifact,
  onRestoreRecipe,
  onRenameRecipe,
  onDeleteRecipe,
}: InspectorPaneProps) {
  if (!activeSet && !activeArtifact && !activeMemberId) {
    return (
      <StudioPane title="Details" showHeader={false}>
        <div className="rounded-sm border border-border bg-background px-3 py-3">
          <div className="text-bf-md font-medium text-foreground">Nothing selected</div>
          <div className="mt-1 text-bf-sm leading-5 text-muted-foreground">
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
    return artifact.materializationKey ?? 'No file';
  };

  const materializedLabel = (artifact: StudioArtifactSummary | null): string => {
    if (!artifact) {
      return 'Not computed';
    }
    if (artifact.materializedAtMs) {
      return formatTimestamp(artifact.materializedAtMs);
    }
    if (artifact.cacheStatus === 'source') {
      return 'Read from the image file';
    }
    if (artifact.cacheStatus === 'failed') {
      return 'Could not be computed';
    }
    if (artifact.cacheStatus === 'synthetic') {
      return 'Example image';
    }
    return artifact.bindingKind === 'derived_field'
      ? 'Not computed yet'
      : 'Read from the image file';
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

  const activeCompareLabel = activeArtifact?.cohortLabel ?? compareCohort?.label ?? 'None';
  // The source by its file name; the full path (often a cache) is its tooltip
  // and in ⋯ › Provenance….
  const sourcePath = activeArtifact?.sourcePath ?? activeMember?.sourcePath ?? null;
  const sourceName = sourcePath ? fileNameOf(sourcePath) : null;
  // "Computed as" only when it reads as words; code-like recipes
  // ("member(sub-1002)") are in Provenance….
  const recipe = activeArtifact?.recipe ?? activeExpression?.recipe ?? null;
  const readableRecipe = recipe && isReadableRecipe(recipe) ? recipe : null;

  return (
    <StudioPane
      title="Details"
      showHeader={false}
    >
      <div className="space-y-4 text-bf-md text-foreground">
        {!activeArtifact && !activeMemberId ? (
          <Notice role={undefined} severity="neutral">
            <div className="font-medium text-foreground">Nothing selected</div>
            <div>Select a member or compare result to inspect it here.</div>
          </Notice>
        ) : (
          <div className="rounded-sm border border-border bg-background">
            <Section variant="static" divider={false} title="Current">
              <KeyValue
                columns={1}
                items={[
                  { label: 'Active', value: activeArtifact?.title ?? activeMemberId ?? 'No member selected' },
                  {
                    label: 'Source',
                    value: sourceName ? (
                      <span title={sourcePath ?? undefined} data-testid="inspector-source">
                        {sourceName}
                      </span>
                    ) : (
                      'No file'
                    ),
                  },
                  ...(readableRecipe
                    ? [{ label: 'Computed as', value: readableRecipe, mono: false, wrap: true }]
                    : []),
                  { label: 'Compare', value: activeCompareLabel, mono: false },
                  { label: 'Scope', value: scopeCohort?.label ?? 'All members', mono: false },
                ]}
              />
            </Section>

            {activeSet ? (
              <Section variant="static" title="Dataset">
                <KeyValue
                  columns={1}
                  items={[
                    {
                      label: 'Image grids',
                      value:
                        activeSet.alignmentClass === 'same-grid'
                          ? `One grid · ${activeSet.supportLabel}`
                          : activeSet.alignmentClass === 'mixed'
                            ? 'Different grids'
                            : 'Not checked',
                      mono: false,
                    },
                    {
                      label: 'Import',
                      value: `${activeSet.ingestAudit.join.matchedRows} matched · ${activeSet.ingestAudit.join.unmatchedRows} unmatched`,
                    },
                  ]}
                />
              </Section>
            ) : null}

            {/* Copy recipe, paths and JSON, Save recipe, the cache and the
                provenance file moved to the Studio's ⋯ › Provenance… (B5). */}
            <p className="m-0 px-3 py-2 text-bf-xs text-muted-foreground">
              Recipe, cache and provenance: ⋯ › Provenance… in the Studio header.
            </p>
          </div>
        )}

        <Section title="Saved recipes" meta={String(savedRecipes.length)} defaultOpen={false}>
            {savedRecipes.length === 0 ? (
              <div className="text-bf-sm text-muted-foreground">No saved recipes yet.</div>
            ) : (
              <div className="space-y-2">
                {savedRecipes.map((recipe) => (
                  <div key={recipe.id} className="rounded-sm border border-border bg-card px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(recipe.artifact)}
                      className="w-full text-left"
                    >
                      <div className="text-bf-sm text-muted-foreground">
                        saved {formatTimestamp(recipe.savedAtMs)}
                      </div>
                      <div className="mt-1 text-bf-md text-foreground">{recipe.title}</div>
                      <div className="mt-1 text-bf-sm text-muted-foreground">
                        {recipe.subtitle ?? recipe.artifact.recipe ?? 'No recipe subtitle'}
                      </div>
                      <div className="mt-1 text-bf-sm text-muted-foreground">
                        {formatSavedRecipeSummary(recipe)}
                      </div>
                      {recipe.scopeCohortLabel ? (
                        <div className="mt-1 text-bf-sm text-muted-foreground">
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
                        Copy recipe
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
        </Section>
        <Section title="Recent artifacts" meta={String(artifactHistory.length)} defaultOpen={false}>
            {artifactHistory.length === 0 ? (
              <div className="text-bf-sm text-muted-foreground">No artifact history yet.</div>
            ) : (
              <div className="space-y-2">
                {artifactHistory.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={`rounded-sm border px-3 py-2 transition-colors ${
                      activeArtifact?.id === artifact.id
                        ? cn('border-border', SELECTED)
                        : 'border-border bg-card'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(artifact)}
                      className="w-full text-left"
                    >
                      <div className="text-bf-sm text-muted-foreground">
                        {artifact.lens} {artifact.paneId ? `· ${artifact.paneId}` : ''} · inspected {formatTimestamp(artifact.capturedAtMs)}
                      </div>
                      <div className="mt-1 text-bf-md text-foreground">{artifact.title}</div>
                      <div className="mt-1 text-bf-sm text-muted-foreground">
                        {artifactBindingLabel(artifact)}
                      </div>
                      <div className="mt-1 text-bf-sm text-muted-foreground">
                        materialized {materializedLabel(artifact)}
                      </div>
                      <div className="mt-1 text-bf-sm text-muted-foreground">
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
        </Section>
      </div>
    </StudioPane>
  );
}

/** A path's last part ("same_item.nii.gz"); the whole text when it has none. */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Whether a recipe reads as words rather than code: no call syntax, brackets
 * or operators ("member(sub-1002)", "mean(set) - member" are code).
 */
function isReadableRecipe(recipe: string): boolean {
  return !/[()[\]{}=<>|&*/\\]/.test(recipe);
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
