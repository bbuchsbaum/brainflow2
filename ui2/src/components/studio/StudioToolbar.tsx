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
            <div className="text-base font-semibold text-foreground">{setName}</div>
            {dataStateLabel ? (
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                {dataStateLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            NeuroTabs · Explore individuals and populations
          </div>
        </div>
        <PopulationOpenControls />
      </div>
    </header>
  );
}
