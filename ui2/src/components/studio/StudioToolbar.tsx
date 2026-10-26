import { Chip } from '@/components/ui/bf';
import { PopulationOpenControls } from './PopulationOpenControls';
interface StudioToolbarProps {
  setName: string;
  dataStateLabel?: string | null;
}

export function StudioToolbar({ setName, dataStateLabel }: StudioToolbarProps) {
  return (
    <header className="border-b border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-bf-lg font-semibold text-foreground">{setName}</div>
            {dataStateLabel ? (
              <Chip>{dataStateLabel}</Chip>
            ) : null}
          </div>
          <div className="mt-1 text-bf-sm text-muted-foreground">
            NeuroTabs · Explore individuals and populations
          </div>
        </div>
        <PopulationOpenControls />
      </div>
    </header>
  );
}
