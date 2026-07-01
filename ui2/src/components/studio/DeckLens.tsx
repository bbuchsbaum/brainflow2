import React, { useMemo } from 'react';
import type { SpatialFieldSetSummary, StudioFeatureSummary } from '@/types/studio';
import { Button } from '@/components/ui/Button';
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
  const previousMemberId = memberIndex > 0 ? memberIds[memberIndex - 1] : null;
  const nextMemberId =
    memberIndex >= 0 && memberIndex < memberIds.length - 1 ? memberIds[memberIndex + 1] : null;

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">Deck</div>
          <div className="mt-1 text-sm text-muted-foreground">Browse members one at a time.</div>
          {searchLabel || sortLabel || (filterLabels?.length ?? 0) > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <div className="flex items-center gap-2">
          <div className="mr-2 text-xs text-muted-foreground">
            {memberIndex >= 0 ? `${memberIndex + 1} of ${memberIds.length}` : 'No member selected'}
          </div>
          {scopeLabel && onClearScope ? (
            <Button variant="ghost" size="sm" onClick={onClearScope}>
              Clear Scope
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => previousMemberId && onSelectMember(previousMemberId)}
            disabled={!previousMemberId}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => nextMemberId && onSelectMember(nextMemberId)}
            disabled={!nextMemberId}
          >
            Next
          </Button>
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
            ...(activeMemberSourcePath ? [{ label: 'Open Source', onClick: onOpenCurrentSource }] : []),
          ]}
        />
      </div>
    </div>
  );
}
