import React, { useMemo } from 'react';
import type { SpatialFieldSetSummary, StudioFeatureSummary } from '@/types/studio';
import { Button, Chip, Pager } from '@/components/ui/bf';
import { setImportReadiness } from '@/services/studio/importContract';
import { StudioRenderAdapter } from './StudioRenderAdapter';
import { StudioToolbarPortal } from './StudioToolbarSlot';

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

  const subtitle = `${activeFeature?.label ?? 'No feature'} on ${activeSet?.supportLabel ?? 'unknown support'}`;
  const chips = [
    searchLabel ? `Search ${searchLabel}` : null,
    sortLabel ? `Sort ${sortLabel}` : null,
    ...(filterLabels ?? []),
  ].filter((chip): chip is string => !!chip);

  return (
    <div className="flex h-full flex-col">
      {/* The member line and pager join the Studio toolbar row (QA N13). */}
      <StudioToolbarPortal>
        <div className="flex min-w-0 flex-nowrap items-center gap-2" aria-label="Deck">
          <div className="min-w-0 truncate text-bf-sm" title={`${footer}${chips.length ? ` · ${chips.join(' · ')}` : ''}`}>
            <span className="font-medium text-foreground">{activeMemberId ?? 'No active member'}</span>{' '}
            <span className="text-muted-foreground">{subtitle}</span>
          </div>
          {chips.length > 0 ? <Chip>{chips.length === 1 ? chips[0] : `${chips.length} filters`}</Chip> : null}
          {scopeLabel && onClearScope ? (
            <Button variant="ghost" size="sm" onClick={onClearScope}>
              Clear scope
            </Button>
          ) : null}
          <Button variant="link" className="min-h-6 shrink-0" size="sm" onClick={onInspectCurrent}>
            Inspect
          </Button>
          {activeMemberSourcePath ? (
            <Button variant="link" className="min-h-6 shrink-0" size="sm" onClick={onOpenCurrentSource}>
              Open source
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
            <span className="shrink-0 text-bf-sm text-muted-foreground">No member selected</span>
          )}
        </div>
      </StudioToolbarPortal>

      <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-bf-bg-canvas">
        <StudioRenderAdapter
          supportKind={activeSet?.supportKind}
          title={activeMemberId ?? 'No active member'}
          subtitle={subtitle}
          hideChrome
          memberSourcePath={activeMemberSourcePath ?? null}
        />
      </div>
    </div>
  );
}
