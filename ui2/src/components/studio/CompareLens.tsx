import React from 'react';
import { Button } from '@/components/ui/Button';
import type {
  StudioArtifactSummary,
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';
import { StudioViewerPanel } from './StudioViewerPanel';
import { StudioRenderAdapter } from './StudioRenderAdapter';

interface CompareLensProps {
  activeSet: SpatialFieldSetSummary | null;
  activeFeature: StudioFeatureSummary | null;
  activeArtifact: StudioArtifactSummary | null;
  activeMemberId: string | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  cohorts: StudioCohortSummary[];
  activeExpression: StudioFieldExpressionSummary | null;
  paneSpecs: StudioComparePaneSpec[];
  loading: boolean;
  refreshingPaneIds: string[];
  scopeLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  sortLabel?: string | null;
  onSelectCohort: (cohortId: string | null) => void;
  onDrillToCohort: (cohortId: string | null) => void;
  onOpenPane: (pane: StudioComparePaneSpec) => void;
  onInspectPane: (pane: StudioComparePaneSpec) => void;
  onInspectCurrent: () => void;
  onOpenCurrentSource: () => void;
  onOpenCompareView: () => void;
  onRecomputePane: (pane: StudioComparePaneSpec) => void;
}

export function CompareLens({
  activeSet,
  activeFeature,
  activeArtifact,
  activeMemberId,
  activeMember,
  compareCohort,
  cohorts,
  activeExpression,
  paneSpecs,
  loading,
  refreshingPaneIds,
  scopeLabel,
  searchLabel,
  filterLabels,
  sortLabel,
  onSelectCohort,
  onDrillToCohort,
  onOpenPane,
  onInspectPane,
  onInspectCurrent,
  onOpenCurrentSource,
  onOpenCompareView,
  onRecomputePane,
}: CompareLensProps) {
  const supportLabel = activeSet?.supportLabel ?? 'unknown support';
  const featureLabel = activeFeature?.label ?? 'No feature';
  const currentPane = paneSpecs.find((pane) => pane.id === 'current');
  const cohortPane = paneSpecs.find((pane) => pane.id === 'cohort-mean');
  const residualPane = paneSpecs.find((pane) => pane.id === 'residual');
  const zscorePane = paneSpecs.find((pane) => pane.id === 'zscore');
  const displayedArtifact =
    activeArtifact && activeArtifact.lens === 'compare' ? activeArtifact : null;
  const activeViewId = displayedArtifact?.paneId ?? 'current';
  const viewerTitle = displayedArtifact?.title ?? currentPane?.title ?? activeMemberId ?? 'Current member';
  const viewerSubtitle =
    displayedArtifact?.subtitle ??
    (displayedArtifact?.recipe
      ? displayedArtifact.recipe
      : `${featureLabel} on ${supportLabel}`);
  const viewerFooter =
    displayedArtifact && (displayedArtifact.sourcePath || displayedArtifact.materializationKey)
      ? `${displayedArtifact.recipe ?? displayedArtifact.title} · ${
          displayedArtifact.sourcePath ?? displayedArtifact.materializationKey
        }`
      : paneFooter(currentPane);
  const viewerActions = [
    { label: 'Inspect', onClick: onInspectCurrent },
    ...((displayedArtifact?.sourcePath ?? activeMember?.sourcePath)
      ? [
          {
            label: displayedArtifact?.bindingKind === 'derived_field' ? 'Open Output' : 'Open Source',
            onClick: onOpenCurrentSource,
          },
        ]
      : []),
    ...(displayedArtifact?.paneId && displayedArtifact.paneId !== 'current' && displayedArtifact.sourcePath && activeMember?.sourcePath
      ? [{ label: 'Open Compare View', onClick: onOpenCompareView }]
      : []),
  ];
  const switcherPanes = [
    { id: 'current', label: 'Current', pane: currentPane },
    { id: 'cohort-mean', label: 'Mean', pane: cohortPane },
    { id: 'residual', label: 'Residual', pane: residualPane },
    { id: 'zscore', label: 'Z-score', pane: zscorePane },
  ];

  const handleActivateView = (paneId: string, pane: StudioComparePaneSpec | undefined) => {
    if (paneId === 'current') {
      onInspectCurrent();
      return;
    }

    if (pane) {
      onOpenPane(pane);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">Compare</div>
          <div className="mt-1 text-sm text-muted-foreground">Switch between current and cohort-derived outputs.</div>
          {loading ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Refreshing compare pane bindings...
            </div>
          ) : null}
          {scopeLabel || searchLabel || sortLabel || (filterLabels?.length ?? 0) > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {scopeLabel ? (
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-700 dark:text-sky-200">
                  Scope {scopeLabel}
                </span>
              ) : null}
              {searchLabel ? (
                <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-700 dark:text-violet-200">
                  Search {searchLabel}
                </span>
              ) : null}
              {sortLabel ? (
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  Sort {sortLabel}
                </span>
              ) : null}
              {filterLabels?.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-700 dark:text-violet-200"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Cohort
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={compareCohort?.id ?? ''}
            onChange={(event) => onSelectCohort(event.target.value || null)}
          >
            <option value="">None</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
            <div className="mr-2 text-xs font-medium text-muted-foreground">Viewing</div>
            {switcherPanes.map(({ id, label, pane }) => {
              const selected = activeViewId === id;
              const badge = id === 'current' ? 'live' : paneBadge(pane, refreshingPaneIds);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleActivateView(id, pane)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    selected
                      ? 'border-border bg-accent text-accent-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <span>{label}</span>
                  <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    {badge}
                  </span>
                </button>
              );
            })}
          </div>

          <StudioRenderAdapter
            supportKind={activeSet?.supportKind}
            title={viewerTitle}
            subtitle={viewerSubtitle}
            footer={viewerFooter}
            actions={viewerActions}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          {compareCohort ? (
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{compareCohort.label}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{compareCohort.description}</div>
                  {compareCohort.originLabel ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Origin: {compareCohort.originLabel}
                    </div>
                  ) : null}
                </div>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                  {cohortOriginLabel(compareCohort)}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{compareCohort.memberCount} members</span>
                <button
                  type="button"
                  onClick={() => onDrillToCohort(compareCohort.id)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Open In Deck
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-3">
            <ComparePaneCard
              title={cohortPane?.title ?? compareCohort?.label ?? 'Cohort mean'}
              subtitle={cohortPane?.subtitle ?? 'Select a cohort to enable comparisons'}
              badge={paneBadge(cohortPane, refreshingPaneIds)}
              accent="emerald"
              selected={activeViewId === 'cohort-mean'}
              pane={cohortPane}
              footer={paneFooter(cohortPane, refreshingPaneIds)}
              actions={paneActions(cohortPane, compareCohort?.id ?? null, refreshingPaneIds, onDrillToCohort, onOpenPane, onInspectPane, onRecomputePane)}
            />
            <ComparePaneCard
              title={residualPane?.title ?? 'Residual'}
              subtitle={residualPane?.subtitle ?? 'Needs cohort selection'}
              badge={paneBadge(residualPane, refreshingPaneIds)}
              accent="amber"
              selected={activeViewId === 'residual'}
              pane={residualPane}
              footer={paneFooter(residualPane, refreshingPaneIds)}
              actions={paneActions(residualPane, compareCohort?.id ?? null, refreshingPaneIds, onDrillToCohort, onOpenPane, onInspectPane, onRecomputePane)}
            />
            <ComparePaneCard
              title={zscorePane?.title ?? 'Z-score'}
              subtitle={zscorePane?.subtitle ?? activeExpression?.recipe ?? 'Select a comparison expression'}
              badge={paneBadge(zscorePane, refreshingPaneIds)}
              selected={activeViewId === 'zscore'}
              pane={zscorePane}
              footer={paneFooter(zscorePane, refreshingPaneIds)}
              actions={paneActions(zscorePane, compareCohort?.id ?? null, refreshingPaneIds, onDrillToCohort, onOpenPane, onInspectPane, onRecomputePane)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareResultSummary({ pane }: { pane: StudioComparePaneSpec | undefined }) {
  if (!pane) {
    return <div className="text-sm text-muted-foreground">No result selected yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted-foreground">Status</div>
        <div className="mt-1 text-sm text-foreground">{pane.reason}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Binding</div>
        <div className="mt-1 break-all text-sm text-foreground">
          {pane.binding?.sourcePath ??
            pane.binding?.materializationKey ??
            'Waiting for a renderable output'}
        </div>
      </div>
      {pane.recipe ? (
        <div>
          <div className="text-xs text-muted-foreground">Recipe</div>
          <div className="mt-1 text-sm text-foreground">{pane.recipe}</div>
        </div>
      ) : null}
    </div>
  );
}

function ComparePaneCard({
  title,
  subtitle,
  badge,
  accent = 'sky',
  selected,
  pane,
  footer,
  actions,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  accent?: 'sky' | 'emerald' | 'amber';
  selected?: boolean;
  pane: StudioComparePaneSpec | undefined;
  footer?: string;
  actions?: Array<{ label: string; onClick: () => void; loading?: boolean; disabled?: boolean }>;
}) {
  const badgeClass =
    accent === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : accent === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';

  return (
    <div
      className={`rounded-lg border bg-card p-3 transition-colors ${
        selected ? 'border-primary/40 shadow-sm' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {badge ? (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badgeClass}`}>{badge}</span>
        ) : null}
      </div>

      <div className="mt-3">
        <CompareResultSummary pane={pane} />
      </div>

      {footer ? <div className="mt-3 text-xs text-muted-foreground">{footer}</div> : null}

      {actions && actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="sm"
              onClick={action.onClick}
              loading={action.loading}
              disabled={action.disabled}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function cohortOriginLabel(cohort: StudioCohortSummary): string {
  switch (cohort.originKind) {
    case 'issue_focus':
      return 'Issue Focus';
    case 'saved_snapshot':
      return 'Saved Snapshot';
    case 'imported':
    default:
      return 'Imported';
  }
}

function paneBadge(
  pane: StudioComparePaneSpec | undefined,
  refreshingPaneIds: string[]
): string {
  if (pane && refreshingPaneIds.includes(pane.id)) {
    return 'refreshing';
  }
  if (pane?.binding?.kind === 'derived_field' && pane.binding.ready) {
    return 'cached';
  }
  switch (pane?.status) {
    case 'live':
      return 'live';
    case 'pending':
      return 'pending';
    case 'blocked':
    default:
      return 'blocked';
  }
}

function paneFooter(
  pane:
    | {
        binding: StudioComparePaneSpec['binding'];
        reason: string;
        recipe: string | null;
      }
    | undefined,
  refreshingPaneIds: string[]
): string {
  if (!pane) {
    return 'No pane metadata available.';
  }
  const bindingText = pane.binding
    ? pane.binding.kind === 'member_source'
      ? pane.binding.sourcePath
        ? `Binding: source ${pane.binding.sourcePath}`
        : 'Binding: no member source path'
      : pane.binding.sourcePath
        ? `Binding: derived ${pane.binding.sourcePath}`
        : pane.binding.materializationKey
          ? `Binding key: ${pane.binding.materializationKey}`
          : 'Binding: derived output'
    : 'Binding: none';
  const materializedText =
    pane.binding?.materializedAtMs != null
      ? ` Materialized: ${new Date(pane.binding.materializedAtMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}.`
      : '';
  const refreshingText = refreshingPaneIds.includes((pane as StudioComparePaneSpec).id)
    ? ' Recompute in progress.'
    : '';
  return pane.recipe
    ? `${pane.reason} ${bindingText}.${materializedText}${refreshingText} Recipe: ${pane.recipe}`
    : `${pane.reason} ${bindingText}.${materializedText}${refreshingText}`;
}

function paneActions(
  pane:
    | {
        id: StudioComparePaneSpec['id'];
        binding: StudioComparePaneSpec['binding'];
      }
    | undefined,
  cohortId: string | null,
  refreshingPaneIds: string[],
  onDrillToCohort: (cohortId: string | null) => void,
  onOpenPane: (pane: StudioComparePaneSpec) => void,
  onInspectPane: (pane: StudioComparePaneSpec) => void,
  onRecomputePane: (pane: StudioComparePaneSpec) => void
): Array<{ label: string; onClick: () => void; loading?: boolean; disabled?: boolean }> | undefined {
  const actions: Array<{ label: string; onClick: () => void; loading?: boolean; disabled?: boolean }> = [];
  const isRefreshing = pane ? refreshingPaneIds.includes(pane.id) : false;
  if (pane) {
    actions.push({
      label: 'Inspect',
      onClick: () => onInspectPane(pane as StudioComparePaneSpec),
    });
  }
  if (pane?.binding?.kind === 'derived_field') {
    actions.push({
      label: 'Recompute',
      onClick: () => onRecomputePane(pane as StudioComparePaneSpec),
      loading: isRefreshing,
      disabled: isRefreshing,
    });
  }
  if (pane?.binding?.ready && pane.binding.sourcePath) {
    actions.push({
      label: pane.binding.kind === 'derived_field' ? 'Open Derived Output' : 'Open Source',
      onClick: () => onOpenPane(pane as StudioComparePaneSpec),
      disabled: isRefreshing,
    });
  }
  if (cohortId && pane && pane.binding?.kind === 'derived_field') {
    actions.push({
      label: 'Drill to Cohort',
      onClick: () => onDrillToCohort(cohortId),
      disabled: isRefreshing,
    });
  }
  return actions.length > 0 ? actions : undefined;
}
