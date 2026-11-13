import React, { useMemo } from 'react';
import type { SpatialFieldSetSummary, StudioFeatureSummary } from '@/types/studio';
import { Button, Chip, Pager } from '@/components/ui/bf';
import { StudioRenderAdapter } from './StudioRenderAdapter';
import { StudioMemberLoadOverlay } from './StudioMemberLoadOverlay';
import { StudioToolbarPortal } from './StudioToolbarSlot';
import { StudioPlaneToggle } from './StudioPlaneToggle';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStudioWorkspaceKey } from '@/hooks/useStudioWorkspace';
import { findLayerIdForSourcePath } from '@/services/studio/StudioDisplayService';
import { studioSetMaps } from '@/services/studio/studioMaps';
import { shortImageNames } from '@/services/studio/designPanelModel';
import {
  STUDIO_DIVERGING_COLORMAP,
  formatStudioScaleValue,
  scaleClipping,
} from '@/services/studio/studioMapDisplay';
import { PopulationScaleStrip } from './PopulationColorbar';
import {
  OPEN_IN_VIEWER_NO_SOURCE,
  openStudioFileInViewer,
} from '@/services/studio/studioOpenInViewer';

/**
 * The member's symmetric diverging window (the Studio default, or one the
 * user set on the same colour map) with a symmetric threshold, for the
 * Subject lens's footer bar; null for any other display — an asymmetric
 * window or threshold included, which the footer strip (one band about zero)
 * cannot draw — and the view keeps its own colorbar.
 */
function useMemberScale(sourcePath: string | null | undefined) {
  const workspaceKey = useStudioWorkspaceKey();
  const layerId = useLayerStore((state) =>
    sourcePath ? findLayerIdForSourcePath(state, sourcePath) : null,
  );
  const dataRange = useLayerStore((state) =>
    layerId ? state.layerMetadata.get(layerId)?.dataRange : undefined,
  );
  const limit = useViewStateStore((state) => {
    const layer = layerId
      ? state.getWorkspaceViewState(workspaceKey).layers.find((candidate) => candidate.id === layerId)
      : undefined;
    if (!layer?.intensity || layer.colormap !== STUDIO_DIVERGING_COLORMAP) return null;
    const [low, high] = layer.intensity;
    return low < 0 && Math.abs(low + high) <= 1e-9 * high ? high : null;
  });
  // The hidden band's half-width, or null when the threshold is not
  // symmetric about zero (the strip would misdraw it as symmetric).
  const band = useViewStateStore((state) => {
    const layer = layerId
      ? state.getWorkspaceViewState(workspaceKey).layers.find((candidate) => candidate.id === layerId)
      : undefined;
    if (!layer?.threshold) return 0;
    const [low, high] = layer.threshold;
    const half = Math.max(Math.abs(low), Math.abs(high));
    return Math.abs(low + high) <= 1e-9 * Math.max(half, 1e-300) ? half : null;
  });
  if (limit === null || band === null) return null;
  return {
    limit,
    bandFraction: limit > 0 ? band / limit : 0,
    clipped: dataRange ? scaleClipping([dataRange.min, dataRange.max], -limit, limit) : null,
  };
}

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
  visibleMemberIds,
}: DeckLensProps) {
  // One large view of the session's plane (QA N13 b).
  const plane = useSetStudioStore((state) => state.studioPlane);
  const memberIds = visibleMemberIds ?? activeSet?.memberIds ?? [];
  const memberIndex = activeMemberId ? memberIds.indexOf(activeMemberId) : -1;

  // The member, then the map shown by its short name ("same_item"), never its
  // file path. The set-wide grid state is the set header's to say, once.
  const features = useSetStudioStore((state) => state.features);
  const subtitle = useMemo(() => {
    const label = activeFeature?.label ?? '';
    const short = activeFeature
      ? studioSetMaps(activeSet, features).find((map) => map.id === activeFeature.id)?.short
      : undefined;
    return short ?? (label ? (shortImageNames([label]).get(label) ?? label) : '');
  }, [activeSet, activeFeature, features]);
  // A signed member on the Studio's diverging scale: one bar under the view
  // (the Population footer's), none inside it.
  const scale = useMemberScale(activeMemberSourcePath);
  const footer = useMemo(() => {
    if (!activeSet || !activeMemberId) {
      return 'Open a set to start browsing members.';
    }
    return [activeMemberId, subtitle].filter(Boolean).join(' · ');
  }, [activeMemberId, activeSet, subtitle]);

  const chips = [
    searchLabel ? `Search ${searchLabel}` : null,
    sortLabel ? `Sort ${sortLabel}` : null,
    ...(filterLabels ?? []),
  ].filter((chip): chip is string => !!chip);

  return (
    <div className="flex h-full flex-col">
      {/* The member line and pager join the Studio toolbar row (QA N13). */}
      <StudioToolbarPortal>
        <div
          className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1"
          aria-label="Deck"
        >
          <StudioPlaneToggle />
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
          {/* The member's file in a viewer tab of its own; the Studio's view stays as it is. */}
          {activeMemberId ? (
            <Button
              variant="link"
              className="min-h-6 shrink-0"
              size="sm"
              disabled={!activeMemberSourcePath?.trim()}
              title={
                activeMemberSourcePath?.trim()
                  ? `Open ${activeMemberSourcePath.trim()} in a new viewer tab`
                  : OPEN_IN_VIEWER_NO_SOURCE
              }
              onClick={() => openStudioFileInViewer(activeMemberSourcePath)}
            >
              Open in viewer
            </Button>
          ) : null}
          {memberIndex >= 0 ? (
            <div className="shrink-0 whitespace-nowrap">
            <Pager
              noun="member"
              page={memberIndex + 1}
              count={memberIds.length}
              onPageChange={(page) => {
                const memberId = memberIds[page - 1];
                if (memberId) onSelectMember(memberId);
              }}
            />
            </div>
          ) : (
            <span className="shrink-0 text-bf-sm text-muted-foreground">No member selected</span>
          )}
        </div>
      </StudioToolbarPortal>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-bf-bg-canvas">
        <StudioRenderAdapter
          supportKind={activeSet?.supportKind}
          title={activeMemberId ?? 'No active member'}
          subtitle={subtitle}
          hideChrome
          plane={plane}
          memberSourcePath={activeMemberSourcePath ?? null}
          hideColorbar={!!scale}
        />
        <StudioMemberLoadOverlay sourcePath={activeMemberSourcePath ?? null} />
      </div>
      {scale ? (
        <div
          data-testid="deck-scale"
          className="flex h-6 shrink-0 items-center justify-end gap-1.5 font-mono text-bf-2xs tabular-nums text-bf-text-secondary"
          title={`${subtitle || 'Map'}: colour ±${formatStudioScaleValue(scale.limit)}`}
        >
          <PopulationScaleStrip
            limit={scale.limit}
            range={`${formatStudioScaleValue(-scale.limit)} to ${formatStudioScaleValue(scale.limit)}`}
            bandFraction={scale.bandFraction}
            format={formatStudioScaleValue}
            clipped={scale.clipped}
            label={`Colour scale of ${subtitle || 'the map'}`}
          />
        </div>
      ) : null}
    </div>
  );
}
