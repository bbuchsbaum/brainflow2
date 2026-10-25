import React from 'react';
import { Button } from '@/components/ui/Button';

interface StudioViewerAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface StudioViewerPanelProps {
  title: string;
  subtitle: string;
  badge?: string;
  footer?: string;
  accent?: 'sky' | 'emerald' | 'amber';
  actions?: StudioViewerAction[];
  body?: React.ReactNode;
}

export function StudioViewerPanel({
  title,
  subtitle,
  badge,
  footer,
  accent = 'sky',
  actions,
  body,
}: StudioViewerPanelProps) {
  const badgeClass =
    accent === 'emerald'
      ? 'border-bf-success/40 text-bf-success'
      : accent === 'amber'
        ? 'border-bf-warning/50 text-bf-warning'
        : 'border-border bg-bf-bg-active text-bf-text-secondary';

  return (
    <div className="flex h-full min-h-[220px] flex-col rounded-sm border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-bf-md font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-bf-sm text-muted-foreground">{subtitle}</div>
        </div>
        {badge ? (
          <span className={`rounded-sm border px-2.5 py-1 text-bf-xs ${badgeClass}`}>
            {badge}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-4">
        <div className="h-full rounded-sm border border-border bg-background/60 p-4">
          {body ?? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <div className="text-bf-md font-medium text-foreground">{title}</div>
                <div className="mt-2 text-bf-md text-muted-foreground">{subtitle}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {footer ? (
        <div className="border-t border-border px-4 py-3">
          <div className="text-bf-sm text-muted-foreground">{footer}</div>
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
      ) : null}
    </div>
  );
}
