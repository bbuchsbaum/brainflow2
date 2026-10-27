import React, { useMemo } from 'react';
import type { SpatialFieldSetSummary, StudioFeatureSummary } from '@/types/studio';
import { Button, Chip, Pager } from '@/components/ui/bf';
import { setImportReadiness } from '@/services/studio/importContract';
import { StudioRenderAdapter } from './StudioRenderAdapter';

interface DeckLensProps {
  activeSet: SpatialFieldSetSummary | null;
  activeFeature: StudioFeatureSummary | null;
  activeMemberId: string | null;
  activeMemberSourcePath?: string | null;
  scopeLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  sortLabel?: string | null;
  onClearScope?: () => void;
  onSelectMember: (memberId: string) => void;
  onInspectCurrent: () => void;
  onOpenCurrentSource: () => void;
  visibleMemberIds?: string[];
}

export function DeckLens({
  activeSet,
  activeFeature,
  activeMemberId,
  activeMemberSourcePath,
  scopeLabel,
  searchLabel,
  filterLabels,
  sortLabel,
  onClearScope,
  onSelectMember,
  onInspectCurrent,
  onOpenCurrentSource,
  visibleMemberIds,
}: DeckLensProps) {
  const memberIds = visibleMemberIds ?? activeSet?.memberIds ?? [];
  const memberIndex = activeMemberId ? memberIds.indexOf(activeMemberId) : -1;

  const footer = useMemo(() => {
    if (!activeSet || !activeMemberId) {
      return 'Import a set to start browsing members.';
    }
    const readiness = setImportReadiness(activeSet);
    const supportState =
      readiness === 'compare_ready'
        ? 'compare-safe'
        : readiness === 'inspect_only'
          ? 'inspect-only'
          : readiness === 'blocked'
            ? 'import blocked'
            : 'review required';
    return `${activeMemberId} · ${activeSet.supportLabel} · ${supportState}`;
  }, [activeMemberId, activeSet]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2">
        <div>
          <div className="text-bf-md font-medium text-foreground">Deck</div>
          <div className="mt-1 text-bf-md text-muted-foreground">Browse members one at a time.</div>
          {searchLabel || sortLabel || (filterLabels?.length ?? 0) > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {searchLabel ? <Chip>Search {searchLabel}</Chip> : null}
              {sortLabel ? <Chip>Sort {sortLabel}</Chip> : null}
              {filterLabels?.map((label) => <Chip key={label}>{label}</Chip>)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {scopeLabel && onClearScope ? (
            <Button variant="ghost" size="sm" onClick={onClearScope}>
              Clear scope
            </Button>
          ) : null}
          {memberIndex >= 0 ? (
            <Pager
              noun="member"
              page={memberIndex + 1}
              count={memberIds.length}
              onPageChange={(page) => {
                const memberId = memberIds[page - 1];
                if (memberId) onSelectMember(memberId);
              }}
            />
          ) : (
            <span className="text-bf-sm text-muted-foreground">No member selected</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <StudioRenderAdapter
          supportKind={activeSet?.supportKind}
          title={activeMemberId ?? 'No active member'}
          subtitle={`${activeFeature?.label ?? 'No feature'} on ${activeSet?.supportLabel ?? 'unknown support'}`}
          footer={footer}
          actions={[
            { label: 'Inspect', onClick: onInspectCurrent },
            ...(activeMemberSourcePath ? [{ label: 'Open source', onClick: onOpenCurrentSource }] : []),
          ]}
        />
      </div>
    </div>
  );
}
