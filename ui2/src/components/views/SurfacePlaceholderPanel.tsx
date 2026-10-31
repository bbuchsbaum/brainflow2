/**
 * A surface tab brought back after a relaunch (qa-features-2026-10-31 §9):
 * the surface name, its source and a Reload button. Nothing loads until the
 * user asks. When a file source is gone the placeholder says so and offers
 * Close.
 */

import React from 'react';

import { EmptyPane } from '@/components/ui/bf';
import type { SavedSurfaceTab } from '@/stores/surfaceTabRestoreStore';
import {
  defaultSurfaceReloadBackend,
  missingSurfaceSources,
  reloadSurfaceSources,
  type SurfaceReloadBackend,
} from '@/services/surfaceTabReload';

export interface SurfacePlaceholderPanelProps {
  saved: SavedSurfaceTab;
  /** Close this tab (after a reload, or on Close). */
  onClose: () => void;
  /** Injected in tests. */
  backend?: () => Promise<SurfaceReloadBackend>;
}

type Status = 'checking' | 'ready' | 'missing' | 'reloading' | 'failed';

function sourceLabel(saved: SavedSurfaceTab): string {
  return saved.sources
    .map((source) =>
      source.kind === 'template'
        ? `TemplateFlow ${source.space} ${source.geometryType} (${source.hemisphere})`
        : source.path,
    )
    .join(' · ');
}

export const SurfacePlaceholderPanel: React.FC<SurfacePlaceholderPanelProps> = ({
  saved,
  onClose,
  backend = defaultSurfaceReloadBackend,
}) => {
  const [status, setStatus] = React.useState<Status>('checking');
  const [missing, setMissing] = React.useState<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    void backend()
      .then((api) => missingSurfaceSources(saved.sources, api))
      .then((gone) => {
        if (!alive) return;
        // Reload while at least one source is still there.
        setMissing(gone);
        setStatus(gone.length === saved.sources.length ? 'missing' : 'ready');
      })
      .catch(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [saved, backend]);

  const reload = React.useCallback(async () => {
    setStatus('reloading');
    const api = await backend();
    const available = saved.sources.filter((source) => !missing.includes(source.path));
    const loaded = await reloadSurfaceSources(available, api);
    if (loaded > 0) onClose();
    else setStatus('failed');
  }, [backend, missing, onClose, saved.sources]);

  const close = { label: 'Close', onClick: onClose, testId: 'surface-placeholder-close' };
  if (status === 'missing') {
    return (
      <EmptyPane
        data-testid="surface-placeholder"
        data-status={status}
        title={saved.title}
        hint={`The source is gone: ${missing.join(' · ')}`}
        primary={close}
      />
    );
  }
  return (
    <EmptyPane
      data-testid="surface-placeholder"
      data-status={status}
      title={saved.title}
      hint={
        status === 'failed'
          ? `Could not reload ${sourceLabel(saved)}. See the Log.`
          : missing.length > 0
            ? `${sourceLabel(saved)}. Missing: ${missing.join(' · ')}`
            : `${sourceLabel(saved)}. Not loaded since the last session.`
      }
      primary={{
        label: status === 'reloading' ? 'Reloading…' : 'Reload',
        onClick: () => void reload(),
        disabled: status === 'checking' || status === 'reloading',
        testId: 'surface-placeholder-reload',
      }}
      secondary={close}
    />
  );
};
