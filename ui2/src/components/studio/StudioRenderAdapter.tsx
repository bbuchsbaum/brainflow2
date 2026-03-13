import React from 'react';
import { Button } from '@/components/ui/Button';
import type { StudioSupportKind } from '@/types/studio';
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { SurfaceViewPanel } from '@/components/views/SurfaceViewPanel';

interface StudioRenderAdapterProps {
  supportKind: StudioSupportKind | null | undefined;
  title: string;
  subtitle: string;
  footer?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
}

export function StudioRenderAdapter({
  supportKind,
  title,
  subtitle,
  footer,
  actions,
}: StudioRenderAdapterProps) {
  const header = (
    <div className="border-b border-border px-4 py-3 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {actions && actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action.label} variant="ghost" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {footer ? <div className="mt-2 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );

  if (supportKind === 'volume') {
    return (
      <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-black">
        {header}
        <div className="min-h-0 flex-1">
          <OrthogonalViewContainer className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (supportKind === 'surface') {
    return (
      <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-black">
        {header}
        <div className="min-h-0 flex-1">
          <SurfaceViewPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{subtitle}</div>
        <div className="mt-3 text-xs text-muted-foreground">
          No renderer adapter for support kind {supportKind ?? 'unknown'}
        </div>
      </div>
    </div>
  );
}
