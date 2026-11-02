import React, { useId, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import type { StudioSupportKind } from '@/types/studio';
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { FlexibleSlicePanel } from '@/components/views/FlexibleSlicePanel';
import type { ViewType } from '@/types/coordinates';
import { SurfaceViewPanel } from '@/components/views/SurfaceViewPanelLazy';
import { useStudioMemberRenderScope } from '@/hooks/useStudioMemberRenderScope';
import { ColorbarGroupContext } from '@/components/views/viewportFrame/viewportFrameStore';
import { findLayerIdForSourcePath } from '@/services/studio/StudioDisplayService';
import { useLayerStore } from '@/stores/layerStore';

interface StudioRenderAdapterProps {
  supportKind: StudioSupportKind | null | undefined;
  title: string;
  subtitle: string;
  footer?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
  /** When true, render only the canvas — caller owns the title/footer chrome. */
  hideChrome?: boolean;
  /**
   * Source of the member this view shows. The orthogonal views then draw
   * only that member's layer, never the workspace scene.
   */
  memberSourcePath?: string | null;
  /**
   * With `hideChrome`, show this one plane as a single large view instead of
   * the three orthogonal views (the Deck and Compare pane A; QA N13 b/c).
   */
  plane?: ViewType;
  /**
   * The colorbar describes the member's layer, even when it is the base and
   * whatever else the workspace stacks (Compare pane A: its one colorbar,
   * placed by the shared rule; QA N16).
   */
  describeBase?: boolean;
}

export function StudioRenderAdapter({
  supportKind,
  title,
  subtitle,
  footer,
  actions,
  hideChrome,
  memberSourcePath,
  plane,
  describeBase = false,
}: StudioRenderAdapterProps) {
  useStudioMemberRenderScope(memberSourcePath, supportKind === 'volume');
  // Studio views host their own colorbar, apart from the main views' (one
  // group per adapter instance).
  const group = useId();
  const memberLayerId = useLayerStore((state) =>
    describeBase && memberSourcePath ? findLayerIdForSourcePath(state, memberSourcePath) : null,
  );
  const colorbarGroup = useMemo(
    () => ({ group: `studio${group}`, describeLayerId: memberLayerId ?? null }),
    [group, memberLayerId],
  );

  if (hideChrome) {
    if (supportKind === 'volume') {
      return (
        <ColorbarGroupContext.Provider value={colorbarGroup}>
          {plane ? (
            <div className="h-full w-full" data-studio-plane={plane}>
              <FlexibleSlicePanel key={plane} viewId={plane} />
            </div>
          ) : (
            <OrthogonalViewContainer className="h-full w-full" />
          )}
        </ColorbarGroupContext.Provider>
      );
    }
    if (supportKind === 'surface') {
      return <SurfaceViewPanel />;
    }
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-bf-sm text-muted-foreground">
        No renderer adapter for support kind {supportKind ?? 'unknown'}
      </div>
    );
  }

  const header = (
    <div className="border-b border-border px-4 py-3 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-bf-md font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-bf-sm text-muted-foreground">{subtitle}</div>
        </div>
        {actions && actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action.label} variant="link" className="min-h-6" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {footer ? <div className="mt-2 text-bf-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );

  if (supportKind === 'volume') {
    return (
      <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-sm border border-border bg-bf-bg-canvas">
        {header}
        <div className="min-h-0 flex-1">
          <ColorbarGroupContext.Provider value={colorbarGroup}>
            <OrthogonalViewContainer className="h-full w-full" />
          </ColorbarGroupContext.Provider>
        </div>
      </div>
    );
  }

  if (supportKind === 'surface') {
    return (
      <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-sm border border-border bg-bf-bg-canvas">
        {header}
        <div className="min-h-0 flex-1">
          <SurfaceViewPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-sm border border-dashed border-border bg-card px-6 text-center">
      <div>
        <div className="text-bf-md font-medium text-foreground">{title}</div>
        <div className="mt-2 text-bf-md text-muted-foreground">{subtitle}</div>
        <div className="mt-3 text-bf-sm text-muted-foreground">
          No renderer adapter for support kind {supportKind ?? 'unknown'}
        </div>
      </div>
    </div>
  );
}
