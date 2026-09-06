import { PopulationInspector } from './PopulationInspector';
import { getEventBus } from '@/events/EventBus';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { getConfirmationService } from '@/services/ConfirmationService';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { StudioArtifactSummary, StudioSavedRecipeSummary } from '@/types/studio';
import { InspectorPane } from './InspectorPane';

export function StudioInspectorPanel() {
  const {
    activeSet,
    activeLens,
    activeMemberId,
    activeMember,
    compareCohort,
    scopeCohort,
    activeExpression,
    materialization,
    activeArtifact,
    artifactHistory,
    savedRecipes,
  } = useStudioDerivedState();

  const setActiveArtifact = useSetStudioStore((state) => state.setActiveArtifact);
  const saveRecipeSnapshot = useSetStudioStore((state) => state.saveRecipeSnapshot);
  const renameSavedRecipe = useSetStudioStore((state) => state.renameSavedRecipe);
  const deleteSavedRecipe = useSetStudioStore((state) => state.deleteSavedRecipe);
  const restoreSelectionSnapshot = useSetStudioStore((state) => state.restoreSelectionSnapshot);

  const openArtifact = (artifact: StudioArtifactSummary) => {
    setActiveArtifact(artifact);
    const sourcePath = artifact.sourcePath?.trim() ?? null;
    if (!sourcePath) {
      return;
    }
    void getStudioDisplayService().ensureSourcePathDisplayed(sourcePath, [sourcePath]);
  };

  const restoreArtifact = (artifact: StudioArtifactSummary) => {
    restoreSelectionSnapshot({
      activeLens: artifact.lens,
      activeMemberId: artifact.activeMemberId,
      compareCohortId: artifact.cohortId,
      activeScopeCohortId: artifact.scopeCohortId,
      activeExpressionId: artifact.activeExpressionId,
    });
    openArtifact(artifact);
  };

  const restoreRecipe = (recipe: StudioSavedRecipeSummary) => {
    restoreSelectionSnapshot(recipe.selectionSnapshot);
    openArtifact(recipe.artifact);
  };

  const renameRecipe = async (recipe: StudioSavedRecipeSummary) => {
    const nextTitle =
      (
        await getConfirmationService().prompt({
          title: 'Rename Saved Recipe',
          message: `Rename saved recipe "${recipe.title}" to:`,
          defaultValue: recipe.title,
          confirmLabel: 'Rename',
        })
      )?.trim() ?? '';
    if (!nextTitle || nextTitle === recipe.title) {
      return;
    }

    renameSavedRecipe(recipe.id, nextTitle);
    getEventBus().emit('ui.notification', {
      type: 'success',
      message: `Renamed saved recipe to ${nextTitle}.`,
    });
  };

  const deleteRecipe = async (recipe: StudioSavedRecipeSummary) => {
    const confirmed = await getConfirmationService().confirm({
      title: 'Delete Saved Recipe',
      message: `Delete saved recipe "${recipe.title}"?`,
      tone: 'destructive',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    deleteSavedRecipe(recipe.id);
    getEventBus().emit('ui.notification', {
      type: 'success',
      message: `Deleted saved recipe ${recipe.title}.`,
    });
  };

  if (activeLens === 'population') return <PopulationInspector />;

  return (
    <InspectorPane
      activeSet={activeSet}
      activeMemberId={activeMemberId}
      activeMember={activeMember}
      compareCohort={compareCohort}
      scopeCohort={scopeCohort}
      activeExpression={activeExpression}
      materialization={materialization}
      activeArtifact={activeArtifact}
      artifactHistory={artifactHistory}
      savedRecipes={savedRecipes}
      onSelectArtifact={setActiveArtifact}
      onOpenArtifact={openArtifact}
      onRestoreArtifact={restoreArtifact}
      onSaveRecipeSnapshot={saveRecipeSnapshot}
      onRestoreRecipe={restoreRecipe}
      onRenameRecipe={(recipe) => {
        void renameRecipe(recipe);
      }}
      onDeleteRecipe={(recipe) => {
        void deleteRecipe(recipe);
      }}
    />
  );
}
