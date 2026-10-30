import React from 'react';
import { Button } from '@/components/ui/Button';
import type { StudioSupportKind } from '@/types/studio';
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { SurfaceViewPanel } from '@/components/views/SurfaceViewPanelLazy';
import { useStudioMemberRenderScope } from '@/hooks/useStudioMemberRenderScope';

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
}

export function StudioRenderAdapter({
  supportKind,
  title,
  subtitle,
  footer,
  actions,
  hideChrome,
  memberSourcePath,
}: StudioRenderAdapterProps) {
  useStudioMemberRenderScope(memberSourcePath, supportKind === 'volume');

  if (hideChrome) {
    if (supportKind === 'volume') {
      return <OrthogonalViewContainer className="h-full w-full" />;
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
          <OrthogonalViewContainer className="h-full w-full" />
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
