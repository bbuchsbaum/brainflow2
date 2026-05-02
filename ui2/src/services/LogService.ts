/**
 * LogService — bridges EventBus into `useLogStore`.
 *
 * Subscribes once at app startup. Each subscription maps a bus event
 * to a single, human-readable log entry. The Activity panel already
 * tracks fine-grained loading state, so the log focuses on
 * **terminal events** (load complete, load error, surface added,
 * services initialized, atlas eviction) rather than progress ticks.
 *
 * Idempotent: `bootstrapLogService()` returns a teardown function and
 * is safe to call once at app startup. Tests should call the returned
 * teardown in their cleanup hooks.
 */

import { getEventBus } from '@/events/EventBus';
import { addLogEntry } from '@/stores/logStore';

type Unsubscribe = () => void;

let installed: { teardown: Unsubscribe } | null = null;

function basename(path: string): string {
  if (!path) return path;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function bootstrapLogService(): Unsubscribe {
  if (installed) {
    return installed.teardown;
  }

  const bus = getEventBus();
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    bus.on('volume.load.complete', ({ source, duration, layerId }) => {
      addLogEntry({
        level: 'info',
        source: 'volume',
        message: `Loaded ${basename(source)} (layer ${layerId.slice(0, 8)}, ${duration} ms)`,
      });
    }),
  );
  unsubs.push(
    bus.on('volume.load.error', ({ source, error }) => {
      addLogEntry({
        level: 'error',
        source: 'volume',
        message: `Failed to load ${basename(source)}: ${error.message}`,
      });
    }),
  );

  unsubs.push(
    bus.on('surface.loaded', ({ filename, handle }) => {
      addLogEntry({
        level: 'info',
        source: 'surface',
        message: `Loaded surface ${filename} (${handle.slice(0, 8)})`,
      });
    }),
  );
  unsubs.push(
    bus.on('surface.load.error', ({ filename, error }) => {
      addLogEntry({
        level: 'error',
        source: 'surface',
        message: `Failed to load surface ${filename}: ${error}`,
      });
    }),
  );
  unsubs.push(
    bus.on('surface.template.loaded', ({ space, geometry_type, hemisphere, vertexCount }) => {
      addLogEntry({
        level: 'info',
        source: 'surface',
        message: `Template ${space}/${hemisphere}/${geometry_type} loaded (${vertexCount} vertices)`,
      });
    }),
  );

  unsubs.push(
    bus.on('layer.error', ({ layerId, error }) => {
      addLogEntry({
        level: 'error',
        source: 'layer',
        message: `Layer ${layerId.slice(0, 8)} error: ${error.message}`,
      });
    }),
  );

  unsubs.push(
    bus.on('services.initialized', ({ service }) => {
      addLogEntry({
        level: 'info',
        source: 'services',
        message: `${service} ready`,
      });
    }),
  );
  unsubs.push(
    bus.on('services.error', ({ service, error, fatal }) => {
      addLogEntry({
        level: 'error',
        source: 'services',
        message: `${service ?? 'service'} ${fatal ? 'fatal' : 'error'}: ${error}`,
      });
    }),
  );

  unsubs.push(
    bus.on('atlas.eviction', ({ layerId, reason, message }) => {
      addLogEntry({
        level: 'warn',
        source: 'atlas',
        message:
          message ??
          `Atlas eviction (${reason})${layerId ? ` — layer ${layerId.slice(0, 8)}` : ''}`,
      });
    }),
  );
  unsubs.push(
    bus.on('atlas.pressure', ({ level, reason }) => {
      if (level === 'recovered') return; // Don't spam recovery events.
      addLogEntry({
        level: level === 'critical' ? 'error' : 'warn',
        source: 'atlas',
        message: `Atlas pressure: ${level} (${reason})`,
      });
    }),
  );

  unsubs.push(
    bus.on('ui.notification', ({ type, message }) => {
      // Only mirror notifications that the user benefits from re-reading.
      if (type === 'info' || type === 'success') return;
      addLogEntry({
        level: type === 'error' ? 'error' : 'warn',
        source: 'ui',
        message,
      });
    }),
  );

  const teardown: Unsubscribe = () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        /* swallow */
      }
    }
    installed = null;
  };

  installed = { teardown };
  return teardown;
}

/** Test-only: tear down any installed listeners and reset internal state. */
export function resetLogServiceForTest(): void {
  if (installed) {
    installed.teardown();
  }
  installed = null;
}
