import { getEventBus } from '@/events/EventBus';
import { useStudioDerivedState, buildSubsetCohortDescription, buildSubsetCohortLabel, buildSubsetOriginLabel, trimLabel } from '@/hooks/useStudioDerivedState';
import { getConfirmationService } from '@/services/ConfirmationService';
import { getSetStudioService } from '@/services/studio/SetStudioService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { StudioJoinIssueDetail } from '@/types/studio';
import { DesignPane } from './DesignPane';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

export function StudioDesignPanel() {
  const studioService = getSetStudioService();
  const {
    activeSet,
    activeMemberId,
    compareCohort,
    scopeCohort,
    cohortList,
    activeIssueMemberIds,
    activeIssueLabel,
    designSearch,
    sortColumn,
    sortDirection,
    activeDesignFilters,
    visibleMemberIds,
    quickFilterOptions,
  } = useStudioDerivedState();

  const setActiveMember = useSetStudioStore((state) => state.setActiveMember);
  const setCompareCohort = useSetStudioStore((state) => state.setCompareCohort);
  const setActiveScopeCohort = useSetStudioStore((state) => state.setActiveScopeCohort);
  const setActiveLens = useSetStudioStore((state) => state.setActiveLens);
  const createSavedCohort = useSetStudioStore((state) => state.createSavedCohort);
  const renameSavedCohort = useSetStudioStore((state) => state.renameSavedCohort);
  const deleteSavedCohort = useSetStudioStore((state) => state.deleteSavedCohort);
  const setDesignSearch = useSetStudioStore((state) => state.setDesignSearch);
  const setSortColumn = useSetStudioStore((state) => state.setSortColumn);
  const toggleSortDirection = useSetStudioStore((state) => state.toggleSortDirection);
  const toggleDesignFilter = useSetStudioStore((state) => state.toggleDesignFilter);
  const removeDesignFilter = useSetStudioStore((state) => state.removeDesignFilter);
  const clearDesignFilters = useSetStudioStore((state) => state.clearDesignFilters);
  const clearSubsetNarrowing = useSetStudioStore((state) => state.clearSubsetNarrowing);
  const setActiveIssueFocus = useSetStudioStore((state) => state.setActiveIssueFocus);
  const clearActiveIssueFocus = useSetStudioStore((state) => state.clearActiveIssueFocus);

  const notify = (type: 'success' | 'warning', message: string) => {
    getEventBus().emit('ui.notification', { type, message });
  };

  const saveMembersAsCohort = (args: {
    memberIds: string[];
    label?: string | null;
    description?: string | null;
    originKind?: 'saved_snapshot' | 'issue_focus';
    originLabel?: string | null;
  }) => {
    const cohortId = createSavedCohort(args);
    return cohortId ? useSetStudioStore.getState().cohorts[cohortId] ?? null : null;
  };

  const handleSaveVisibleCohort = () => {
    const savedCohort = saveMembersAsCohort({
      memberIds: visibleMemberIds,
      label: scopeCohort?.label ? `Snapshot · ${scopeCohort.label}` : null,
      description: scopeCohort?.label
        ? `Saved from the current scoped cohort ${scopeCohort.label}.`
        : 'Saved from the current visible Studio members.',
      originKind: 'saved_snapshot',
      originLabel: scopeCohort?.label ?? activeIssueLabel ?? 'Current Studio view',
    });

    if (!savedCohort) {
      notify('warning', 'No visible members were available to save as a cohort.');
      return;
    }

    setActiveScopeCohort(savedCohort.id);
    notify('success', `Saved cohort ${savedCohort.label}.`);
  };

  const handleSaveFilteredSubsetAsCohort = () => {
    const savedCohort = saveMembersAsCohort({
      memberIds: visibleMemberIds,
      label: buildSubsetCohortLabel(activeDesignFilters, designSearch),
      description: buildSubsetCohortDescription(activeDesignFilters, designSearch, scopeCohort?.label ?? null),
      originKind: 'saved_snapshot',
      originLabel: buildSubsetOriginLabel(activeDesignFilters, designSearch, scopeCohort?.label ?? null),
    });

    if (!savedCohort) {
      notify('warning', 'No subset members were available to save as a cohort.');
      return;
    }

    setActiveScopeCohort(savedCohort.id);
    notify('success', `Saved subset cohort ${savedCohort.label}.`);
  };

  const handleUseFilteredSubsetInCompare = () => {
    const savedCohort = saveMembersAsCohort({
      memberIds: visibleMemberIds,
      label: buildSubsetCohortLabel(activeDesignFilters, designSearch),
      description: buildSubsetCohortDescription(activeDesignFilters, designSearch, scopeCohort?.label ?? null),
      originKind: 'saved_snapshot',
      originLabel: buildSubsetOriginLabel(activeDesignFilters, designSearch, scopeCohort?.label ?? null),
    });

    if (!savedCohort) {
      notify('warning', 'No subset members were available for Compare.');
      return;
    }

    setCompareCohort(savedCohort.id);
    setActiveLens('compare');
    notify('success', `Using subset cohort ${savedCohort.label} in Compare.`);
  };

  const handleRenameCohort = async (cohortId: string, currentLabel: string) => {
    const nextLabel = (
      await getConfirmationService().prompt({
        title: 'Rename Group',
        message: `Rename group "${currentLabel}" to:`,
        defaultValue: currentLabel,
        confirmLabel: 'Rename',
      })
    )?.trim() ?? '';
    if (!nextLabel || nextLabel === currentLabel) {
      return;
    }

    renameSavedCohort(cohortId, nextLabel);
    notify('success', `Renamed cohort to ${nextLabel}.`);
  };

  const handleDeleteCohort = async (cohortId: string, label: string) => {
    const confirmed = await getConfirmationService().confirm({
      title: 'Delete Group',
      message: `Delete group "${label}"?`,
      tone: 'destructive',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    deleteSavedCohort(cohortId);
    notify('success', `Deleted cohort ${label}.`);
  };

  const handleSelectJoinIssue = (issue: StudioJoinIssueDetail) => {
    setActiveIssueFocus(issue);
    if (issue.memberIds.length > 0) {
      setActiveMember(issue.memberIds[0]);
    }
  };

  const handleIssueFocusAction = (mode: 'save' | 'compare') => {
    if (activeIssueMemberIds.length === 0) {
      return;
    }

    const savedCohort = saveMembersAsCohort({
      memberIds: activeIssueMemberIds,
      label: activeIssueLabel ? `Issue · ${trimLabel(activeIssueLabel)}` : 'Issue Focus',
      description: activeIssueLabel
        ? `Saved from issue focus: ${activeIssueLabel}`
        : 'Saved from the active issue focus.',
      originKind: 'issue_focus',
      originLabel: activeIssueLabel ?? 'Issue focus',
    });

    if (!savedCohort) {
      notify('warning', mode === 'compare'
        ? 'Issue focus could not be used in Compare.'
        : 'Issue focus could not be saved as a cohort.');
      return;
    }

    if (mode === 'compare') {
      setCompareCohort(savedCohort.id);
      setActiveLens('compare');
      notify('success', `Using issue focus cohort ${savedCohort.label} in Compare.`);
      return;
    }

    setActiveScopeCohort(savedCohort.id);
    setCompareCohort(savedCohort.id);
    notify('success', `Saved issue focus as cohort ${savedCohort.label}.`);
  };

  return (
    <DesignPane
      activeSet={activeSet}
      headerActions={
        <DropdownMenu
          position="bottom-right"
          trigger={
            <Button variant="ghost" size="sm" title="Import study data">
              Import
            </Button>
          }
          items={[
            {
              id: 'import-table',
              label: 'Table (TSV/CSV)',
              onClick: () => { void studioService.openTableImportInStudio(); },
            },
            {
              id: 'import-manifest',
              label: 'NFTab Manifest',
              onClick: () => { void studioService.openManifestInStudio(); },
            },
            {
              id: 'import-discover',
              label: 'Discover Files',
              onClick: () => { void studioService.openRegexDiscoveryInStudio(); },
            },
            {
              id: 'import-demo',
              label: 'Load Demo',
              onClick: () => { void studioService.openDemoInStudio(); },
            },
          ]}
        />
      }
      cohorts={cohortList}
      activeMemberId={activeMemberId}
      activeCompareCohortId={compareCohort?.id ?? null}
      activeScopeCohortId={scopeCohort?.id ?? null}
      activeIssueMemberIds={activeIssueMemberIds}
      visibleMemberIds={visibleMemberIds}
      designSearch={designSearch}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      activeDesignFilters={activeDesignFilters}
      quickFilterOptions={quickFilterOptions}
      scopedCohortLabel={scopeCohort?.label ?? null}
      issueFocusLabel={activeIssueLabel}
      onClearScope={() => setActiveScopeCohort(null)}
      onClearIssueFocus={clearActiveIssueFocus}
      onDesignSearchChange={setDesignSearch}
      onSortColumnChange={setSortColumn}
      onToggleSortDirection={toggleSortDirection}
      onToggleDesignFilter={toggleDesignFilter}
      onRemoveDesignFilter={removeDesignFilter}
      onClearDesignFilters={clearDesignFilters}
      onClearSubsetNarrowing={clearSubsetNarrowing}
      onSelectMember={setActiveMember}
      onUseFilteredSubsetInCompare={handleUseFilteredSubsetInCompare}
      onSaveFilteredSubsetAsCohort={handleSaveFilteredSubsetAsCohort}
      onUseCompareCohort={setCompareCohort}
      onScopeToCohort={setActiveScopeCohort}
      onSaveVisibleCohort={handleSaveVisibleCohort}
      onRenameCohort={(cohort) => {
        void handleRenameCohort(cohort.id, cohort.label);
      }}
      onDeleteCohort={(cohort) => {
        void handleDeleteCohort(cohort.id, cohort.label);
      }}
      onSelectJoinIssue={handleSelectJoinIssue}
      onSaveIssueFocusAsCohort={() => handleIssueFocusAction('save')}
      onUseIssueFocusInCompare={() => handleIssueFocusAction('compare')}
    />
  );
}
