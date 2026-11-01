import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/bf';
import { PopulationOpenControls } from './PopulationOpenControls';

interface StudioToolbarProps {
  setName: string;
  dataStateLabel?: string | null;
  /** The audit facts, shown on the same line (QA N13). */
  audit?: ReactNode;
}

/**
 * The Studio's one-line header: the study, its data state and its audit
 * facts, then opening a saved population. Kept to one line so the maps keep
 * the height (QA N13).
 */
export function StudioToolbar({ setName, dataStateLabel, audit }: StudioToolbarProps) {
  return (
    <header
      className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-1.5 lg:flex-nowrap"
      title="NeuroTabs · Explore individuals and populations"
    >
      <div className="min-w-0 max-w-[16rem] shrink truncate text-bf-md font-semibold text-foreground">
        {setName}
      </div>
      {dataStateLabel ? <Chip className="shrink-0">{dataStateLabel}</Chip> : null}
      {audit ? <span className="h-4 w-px shrink-0 bg-border" aria-hidden /> : null}
      {audit ?? <div className="flex-1" />}
      <PopulationOpenControls inline />
    </header>
  );
}
