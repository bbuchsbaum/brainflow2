import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/bf';
import { PopulationOpenControls } from './PopulationOpenControls';
import { StudioToolbarMore } from './StudioToolbarSlot';
import './studio.css';

interface StudioToolbarProps {
  setName: string;
  /** Where the set lives (a connection and a path): the name's tooltip. */
  setLocation?: { label?: string; path: string } | null;
  dataStateLabel?: string | null;
  /** The audit facts, shown on the same line (QA N13). */
  audit?: ReactNode;
}

/**
 * The Studio's one-line header. The set's name is read first and is the last
 * thing to shorten: the audit facts take only the room it leaves, the data
 * state leaves in a narrow column (studio.css), and opening a saved
 * population sits under More. Kept to one line so the maps keep the height
 * (QA N13).
 */
export function StudioToolbar({ setName, setLocation, dataStateLabel, audit }: StudioToolbarProps) {
  const where = setLocation
    ? [setLocation.label, setLocation.path].filter(Boolean).join(' · ')
    : null;
  return (
    <header className="studio-set-header relative z-30 flex min-w-0 flex-nowrap items-center gap-2 border-b border-border bg-background px-3 py-1.5">
      <div
        className="min-w-0 truncate text-bf-md font-semibold text-foreground [flex:0_1_auto]"
        title={where ? `${setName}\n${where}` : setName}
        data-testid="studio-set-name"
      >
        {setName}
      </div>
      {dataStateLabel ? (
        <Chip className="studio-header-tertiary shrink-0">{dataStateLabel}</Chip>
      ) : null}
      {/* Takes what the name leaves; clips rather than push the name. */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden [flex:1_1000_0%]">
        {audit ? <span className="h-4 w-px shrink-0 bg-border" aria-hidden /> : null}
        {audit}
      </div>
      <StudioToolbarMore label="More">
        <PopulationOpenControls />
      </StudioToolbarMore>
    </header>
  );
}
