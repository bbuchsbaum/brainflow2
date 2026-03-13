import React from 'react';

interface StudioPaneProps {
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  showHeader?: boolean;
  children: React.ReactNode;
}

export function StudioPane({ title, subtitle, headerActions, showHeader = true, children }: StudioPaneProps) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      {showHeader ? (
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{title}</div>
              {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
            </div>
            {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div> : null}
          </div>
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </section>
  );
}
