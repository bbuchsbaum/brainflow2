import React from 'react';
import { getSetStudioService } from '@/services/studio/SetStudioService';
import { useSetStudioStore } from '@/stores/setStudioStore';

export function SetPanel() {
  const activeSetId = useSetStudioStore((state) => state.selection.activeSetId);
  const activeSet = useSetStudioStore((state) =>
    state.selection.activeSetId ? state.sets[state.selection.activeSetId] ?? null : null
  );
  const cohorts = useSetStudioStore((state) => state.cohorts);
  const materialization = useSetStudioStore((state) => state.materialization);
  const savedRecipes = useSetStudioStore((state) => state.savedRecipes);
  const activeCohorts =
    activeSet?.savedCohortIds.map((cohortId) => cohorts[cohortId]).filter(Boolean) ?? [];
  const readiness = deriveSetReadiness(activeSet);

  const handleOpenStudio = () => {
    void getSetStudioService().openStudioWorkspace();
  };

  const handleImportManifest = () => {
    void getSetStudioService().openManifestInStudio();
  };

  const handleRegexDiscovery = () => {
    void getSetStudioService().openRegexDiscoveryInStudio();
  };

  const handleLoadDemo = () => {
    void getSetStudioService().openDemoInStudio();
  };

  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <div className="flex h-full flex-col p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            Set Panel
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Quick access to active field sets, saved cohorts, and recent Studio queries.
          </p>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Active Set
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {activeSet?.name ?? 'None selected'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {activeSetId
                ? `${activeSet?.memberCount ?? 0} members · ${activeSet?.supportLabel ?? 'Unknown support'}`
                : 'Open Set Studio or import a NeuroTabs manifest to begin.'}
            </div>
            {activeSet ? (
              <>
                <div className="mt-2 text-xs text-muted-foreground">
                  Audit: {activeSet.ingestAudit.join.matchedRows} matched,{' '}
                  {activeSet.ingestAudit.join.unmatchedRows} unmatched
                </div>
                {readiness ? (
                  <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${readiness.className}`}>
                    <div className="font-medium">{readiness.eyebrow}</div>
                    <div className="mt-1">{readiness.message}</div>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Saved Cohorts
            </div>
            {activeCohorts.length > 0 ? (
              <div className="mt-2 space-y-2">
                {activeCohorts.slice(0, 4).map((cohort) => (
                  <div
                    key={cohort.id}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
                  >
                    <div className="font-medium text-foreground">{cohort.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {cohort.memberCount} members · {cohortOriginLabel(cohort.originKind)}
                    </div>
                  </div>
                ))}
                {activeCohorts.length > 4 ? (
                  <div className="text-xs text-muted-foreground">+{activeCohorts.length - 4} more cohorts</div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">No saved cohorts yet.</div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Saved Recipes
            </div>
            <div className="mt-2 text-sm text-foreground">
              {savedRecipes.length} saved snapshot{savedRecipes.length === 1 ? '' : 's'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {savedRecipes[0]
                ? `Latest: ${savedRecipes[0].title}`
                : 'Save recipes from the Studio Inspector.'}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Materialization
            </div>
            <div className="mt-2 text-sm text-foreground">
              warm {materialization.warm} · preview {materialization.preview}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              pending {materialization.pending} · failed {materialization.failed}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Quick Actions
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenStudio}
                className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Open Set Studio
              </button>
              <button
                type="button"
                onClick={handleImportManifest}
                className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Import Manifest
              </button>
              <button
                type="button"
                onClick={handleRegexDiscovery}
                className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Discover by Regex
              </button>
              <button
                type="button"
                onClick={handleLoadDemo}
                className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Load Demo
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function deriveSetReadiness(activeSet: ReturnType<typeof useSetStudioStore.getState>['sets'][string] | null) {
  if (!activeSet) {
    return null;
  }

  const hasJoinProblems =
    activeSet.ingestAudit.join.unmatchedRows > 0 || activeSet.ingestAudit.join.duplicateKeys > 0;
  const compareReady = activeSet.ingestAudit.support.readyForCompare && !hasJoinProblems;

  if (compareReady) {
    return {
      eyebrow: 'Compare Ready',
      message: 'Safe to use cohort-relative Compare as the primary workflow.',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-foreground',
    };
  }

  if (
    activeSet.ingestAudit.join.severity === 'error' ||
    activeSet.ingestAudit.support.severity === 'error'
  ) {
    return {
      eyebrow: 'Audit Attention',
      message: 'Import is available for inspection, but compare trust is blocked.',
      className: 'border-rose-500/30 bg-rose-500/10 text-foreground',
    };
  }

  return {
    eyebrow: 'Deck First',
    message: 'Warnings are present; review this set before relying on Compare.',
    className: 'border-amber-500/30 bg-amber-500/10 text-foreground',
  };
}

function cohortOriginLabel(originKind: 'imported' | 'saved_snapshot' | 'issue_focus'): string {
  switch (originKind) {
    case 'issue_focus':
      return 'Issue focus';
    case 'saved_snapshot':
      return 'Saved snapshot';
    case 'imported':
    default:
      return 'Imported';
  }
}
