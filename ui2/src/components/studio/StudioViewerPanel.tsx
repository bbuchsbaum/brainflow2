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
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : accent === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';

  return (
    <div className="flex h-full min-h-[220px] flex-col rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {badge ? (
          <span className={`rounded-full border px-2.5 py-1 text-[11px] ${badgeClass}`}>
            {badge}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-4">
        <div className="h-full rounded-lg border border-border bg-background/60 p-4">
          {body ?? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <div className="text-sm font-medium text-foreground">{title}</div>
                <div className="mt-2 text-sm text-muted-foreground">{subtitle}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {footer ? (
        <div className="border-t border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">{footer}</div>
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
