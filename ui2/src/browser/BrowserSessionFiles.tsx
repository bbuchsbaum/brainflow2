import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import type { BrowserSession } from '../services/browser/session';
import {
  parseSessionRecord,
  restoreSessionRecord,
  type BrowserSessionRecord,
} from '../services/browser/sessionRecord';
import { downloadBlob } from '../services/browser/download';

export function BrowserSessionFiles({
  session,
  onRestore,
}: {
  session: BrowserSession;
  onRestore: (session: BrowserSession) => void;
}) {
  const settings = useRef<HTMLInputElement>(null);
  const sources = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [record, setRecord] = useState<BrowserSessionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    operation.current?.abort();
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    setError(null);
    try {
      await action(abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === abort && !abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async (signal) => {
            const saved = await session.saveRecord(signal);
            signal.throwIfAborted();
            downloadBlob(
              new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }),
              'brainflow-session.json',
            );
          })
        }
      >
        Save session
      </Button>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async (signal) => {
            const generation = session.workspaceGeneration;
            const { exportBrowserImage } = await import('../services/browser/imageExport');
            signal.throwIfAborted();
            const bytes = await exportBrowserImage(session);
            signal.throwIfAborted();
            if (generation !== session.workspaceGeneration) return;
            downloadBlob(
              new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
              'brainflow-view.png',
            );
          })
        }
      >
        Export PNG
      </Button>
      <Button disabled={busy} onClick={() => settings.current?.click()}>
        Restore session
      </Button>
      <input
        ref={settings}
        className="sr-only"
        aria-label="Choose session settings"
        type="file"
        accept=".json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void run(async (signal) => {
              const generation = session.workspaceGeneration;
              if (file.size > 1024 * 1024) throw new Error('Session settings exceed 1 MiB.');
              const text = await file.text();
              signal.throwIfAborted();
              if (generation !== session.workspaceGeneration) return;
              const parsed = parseSessionRecord(text);
              if (!parsed.volumes.length && !parsed.surfaces.length) {
                const restored = await restoreSessionRecord(parsed, [], signal);
                if (signal.aborted || generation !== session.workspaceGeneration) {
                  restored.dispose();
                  return;
                }
                onRestore(restored);
              } else setRecord(parsed);
            });
        }}
      />
      {record && (
        <>
          <span>
            Reselect the original image, surface and table files. Contents will be verified.
          </span>
          <Button disabled={busy} onClick={() => sources.current?.click()}>
            Choose session sources
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => setRecord(null)}>
            Dismiss restore
          </Button>
        </>
      )}
      <input
        ref={sources}
        className="sr-only"
        aria-label="Choose session sources"
        type="file"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (record && files.length)
            void run(async (signal) => {
              const generation = session.workspaceGeneration;
              const restored = await restoreSessionRecord(record, files, signal);
              if (signal.aborted || generation !== session.workspaceGeneration) {
                restored.dispose();
                return;
              }
              onRestore(restored);
            });
        }}
      />
      {busy && (
        <Button
          variant="ghost"
          onClick={() => {
            operation.current?.abort();
            setBusy(false);
          }}
        >
          Cancel session operation
        </Button>
      )}
      {error && <span role="alert">{error}</span>}
    </>
  );
}
