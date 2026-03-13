import React from 'react';

interface StudioStripProps {
  memberIds: string[];
  activeMemberId: string | null;
  scopeLabel?: string | null;
  issueFocusLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  sortLabel?: string | null;
  onSelectMember: (memberId: string) => void;
}

export function StudioStrip({
  memberIds,
  activeMemberId,
  scopeLabel,
  issueFocusLabel,
  searchLabel,
  filterLabels,
  sortLabel,
  onSelectMember,
}: StudioStripProps) {
  const stripContext = [
    scopeLabel,
    issueFocusLabel,
    searchLabel ? `search ${searchLabel}` : null,
    sortLabel ? `sort ${sortLabel}` : null,
    ...(filterLabels ?? []),
  ].filter(Boolean);

  return (
    <div className="col-span-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-xs text-muted-foreground">
        Members
        {stripContext.length > 0 ? ` · ${stripContext.join(' · ')}` : ''}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {memberIds.map((memberId) => {
          const isActive = memberId === activeMemberId;
          return (
            <button
              key={memberId}
              type="button"
              onClick={() => onSelectMember(memberId)}
              className={`min-w-[112px] rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-500/10 text-foreground'
                  : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {memberId}
            </button>
          );
        })}
      </div>
    </div>
  );
}
