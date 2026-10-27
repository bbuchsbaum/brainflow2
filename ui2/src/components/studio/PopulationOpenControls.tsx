import { Button, Notice, TextField } from '@/components/ui/bf';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { populationRestoreService } from '@/services/studio/PopulationRestoreService';
import { formatTauriError } from '@/utils/formatTauriError';

export function PopulationOpenControls() {
  const active = useRef<AbortController | null>(null);
  const [fromDirectory, setFromDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const open = async (relocate = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      await populationRestoreService.chooseAndOpen(
        controller.signal,
        relocate ? fromDirectory : undefined,
      );
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted)
        setError(formatTauriError(error));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-bf-sm">
      <Button variant="secondary" size="sm"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy ? 'Verifying saved inputs…' : 'Open saved population…'}
      </Button>
      {/* App disclosure grammar: chevron right = closed, down = open (no
          native triangle marker). */}
      <details className="group/disclosure w-full">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 -rotate-90 transition-transform group-open/disclosure:rotate-0"
          />
          Sources moved?
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <TextField
            aria-label="Original source directory"
            className="min-w-0 flex-1 w-auto"
            placeholder="Original directory from the saved study"
            value={fromDirectory}
            onChange={(e) => setFromDirectory(e.target.value)}
          />
          <Button variant="secondary" size="sm"
            disabled={busy || !fromDirectory.trim()}
            onClick={() => void open(true)}
          >
            Locate directory and open…
          </Button>
          <p className="w-full text-muted-foreground">
            Choose its new location, then the saved study. Every image must match its saved content
            hash; the original study is preserved.
          </p>
        </div>
      </details>
      {busy && (
        <Button variant="secondary" size="sm"
          onClick={() => active.current?.abort()}
        >
          Cancel open
        </Button>
      )}
      {error && (
        <Notice role="alert" severity="danger" className="w-full">
          {error}
        </Notice>
      )}
    </div>
  );
}
