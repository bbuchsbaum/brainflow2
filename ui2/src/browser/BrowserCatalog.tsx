import { useState } from 'react';
import { useStore } from 'zustand';
import { Select } from '../components/ui/bf/Fields';
import { Button } from '../components/ui/Button';
import { browserCatalog } from '../services/browser/catalog';
import type { BrowserSession } from '../services/browser/session';

export function BrowserCatalog({ session }: { session: BrowserSession }) {
  const ready = useStore(session.store, (state) => state.ready);
  const loading = useStore(session.store, (state) => state.loading);
  const [id, setId] = useState('MNI152NLin2009cAsym_T1w_2mm');
  const entry = browserCatalog.find((entry) => entry.id === id)!;
  return (
    <details className="browser-catalog">
      <summary>Atlas and template catalog</summary>
      <Select aria-label="Catalog item" value={id} onValueChange={setId}>
        {(['template', 'atlas'] as const).map((kind) => (
          <optgroup key={kind} label={kind === 'template' ? 'Templates' : 'Atlases'}>
            {browserCatalog
              .filter((entry) => entry.kind === kind)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
      <p>{entry.description}</p>
      <p>{entry.space}</p>
      {entry.unavailable && <p>{entry.unavailable}</p>}
      <a href={entry.volume.sourceUrl ?? entry.volume.url} target="_blank" rel="noreferrer">
        Original source
      </a>
      <Button
        disabled={!ready || loading || !!entry.unavailable}
        onClick={() => void session.loadCatalog(entry)}
      >
        Load catalog image
      </Button>
      <p className="browser-dimensions">{entry.citation}</p>
    </details>
  );
}
