import { Button, Notice } from '@/components/ui/bf';
import { useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { formatTauriError } from '@/utils/formatTauriError';

export function PopulationMaskControls() {
  const mask = useSetStudioStore((state) => state.population.mask);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await populationProbeActions.chooseMask();
      if (!result.ok) setError(result.reason);
    } catch (error) {
      setError(formatTauriError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-sm border border-border bg-card px-3 py-2 text-bf-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span title={mask?.sourcePath}>
          Mask: {mask ? mask.sourcePath.split(/[\\/]/).at(-1) : 'None · finite values included'}
        </span>
        <Button variant="secondary" size="sm"
          disabled={busy}
          onClick={() => void choose()}
        >
          {busy ? 'Choosing…' : mask ? 'Change mask…' : 'Choose mask…'}
        </Button>
        {mask && (
          <Button variant="secondary" size="sm"
            onClick={() => {
              populationProbeActions.configureMask(null);
              setError(null);
            }}
          >
            Clear mask
          </Button>
        )}
      </div>
      {mask && (
        <p className="mt-1 text-muted-foreground">
          Binary 0/1, same grid. Applies to images and probe values; excluded voxels are
          unavailable. No resampling.
        </p>
      )}
      {error && (
        <Notice role="alert" severity="danger" className="mt-1">
          {error}
        </Notice>
      )}
    </div>
  );
}
