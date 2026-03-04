/**
 * AtlasPressureMonitor
 * Periodically queries atlas metrics and emits warnings when GPU atlas capacity is low.
 */

import { getApiService } from './apiService';
import { getEventBus } from '@/events/EventBus';
import type { AtlasStats } from '@/types/atlas';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { getLayerService } from './LayerService';

type PressureLevel = 'warning' | 'critical' | 'recovered';

interface AtlasPressureEvent {
  level: PressureLevel;
  stats: AtlasStats;
  timestamp: number;
  reason: 'low-watermark' | 'full-event' | 'recovered' | 'evicted';
}

const POLL_INTERVAL_MS = 5_000;
const LOW_WATERMARK_THRESHOLD = 2;
const EVICTION_BACKOFF_MS = 15_000;

/**
 * Minimal hysteresis so we only emit when the number of free layers improves
 * by at least this amount. Prevents flapping when free layer count oscillates.
 */
const RECOVERY_MARGIN = 2;

export class AtlasPressureMonitor {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private lastStats: AtlasStats | null = null;
  private lastWarnedFreeLayers: number | null = null;
  private lastFullEvents = 0;
  private lastEvictedFullEventCount: number | null = null;
  private lastEvictionTimestamp: number | null = null;
  private readonly api = getApiService();
  private readonly eventBus = getEventBus();

  start() {
    if (this.timerId) {
      return;
    }

    // Kick off immediately, then poll on interval.
    void this.poll();
    this.timerId = window.setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    console.log('[AtlasPressureMonitor] Started polling atlas metrics');
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('[AtlasPressureMonitor] Stopped polling atlas metrics');
    }
  }

  private async poll() {
    try {
      const stats = await this.api.getAtlasStats();
      const timestamp = Date.now();

      this.emitMetrics(stats, timestamp);
      this.checkLowWatermark(stats, timestamp);
      await this.checkFullEvents(stats, timestamp);

      this.lastStats = stats;
    } catch (error) {
      console.warn('[AtlasPressureMonitor] Failed to retrieve atlas stats', error);
    }
  }

  private emitMetrics(stats: AtlasStats, timestamp: number) {
    this.eventBus.emit('atlas.metrics', { stats, timestamp });
  }

  private checkLowWatermark(stats: AtlasStats, timestamp: number) {
    // Ignore pressure warnings when no layers are loaded. At startup the atlas
    // may report 0 free / 1 total as a sentinel state, which is noisy if the
    // user has not uploaded any volumes yet.
    const layers = useLayerStore.getState().layers;
    if (!layers || layers.length === 0) {
      this.lastWarnedFreeLayers = null;
      return;
    }

    // Treat low-watermark warnings as noisy for single-layer sessions. On many
    // GPUs the atlas may be relatively small, so the very first allocation can
    // drop freeLayers below the LOW_WATERMARK_THRESHOLD. We only surface
    // yellow "capacity low" signals once the user is actually running a
    // multi-layer session.
    if (layers.length < 2) {
      this.lastWarnedFreeLayers = null;
      return;
    }

    if (stats.freeLayers <= LOW_WATERMARK_THRESHOLD) {
      const isCritical = stats.freeLayers === 0;
      const shouldNotify =
        this.lastWarnedFreeLayers === null || stats.freeLayers < this.lastWarnedFreeLayers;

      if (shouldNotify) {
        this.lastWarnedFreeLayers = stats.freeLayers;
        this.emitPressureEvent(
          isCritical ? 'critical' : 'warning',
          stats,
          timestamp,
          'low-watermark'
        );

        const message = isCritical
          ? `GPU atlas capacity exhausted (${stats.usedLayers}/${stats.totalLayers}). Unload hidden layers to continue rendering.`
          : `GPU atlas capacity low: ${stats.freeLayers} free of ${stats.totalLayers} layers remaining. Consider removing unused layers.`;

        this.eventBus.emit('ui.notification', {
          type: isCritical ? 'error' : 'warning',
          message
        });
      }
      return;
    }

    // We have recovered above the threshold.
    if (
      this.lastWarnedFreeLayers !== null &&
      stats.freeLayers >= this.lastWarnedFreeLayers + RECOVERY_MARGIN
    ) {
      this.lastWarnedFreeLayers = null;
      this.emitPressureEvent('recovered', stats, timestamp, 'recovered');
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `GPU atlas capacity restored: ${stats.freeLayers} free layers available.`
      });
    }
  }

  private async checkFullEvents(stats: AtlasStats, timestamp: number) {
    // Only react to full-events when there are layers in the session.
    // This prevents a spurious "GPU atlas is full" notification on startup
    // before the user has loaded any volumes.
    const layers = useLayerStore.getState().layers;
    if (!layers || layers.length === 0) {
      // Keep the internal counter in sync without emitting UI noise.
      this.lastFullEvents = stats.fullEvents;
      return;
    }

    if (stats.fullEvents > this.lastFullEvents) {
      const increment = stats.fullEvents - this.lastFullEvents;
      this.lastFullEvents = stats.fullEvents;

      this.emitPressureEvent('critical', stats, timestamp, 'full-event');
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: increment > 1
          ? `GPU atlas ran out of layers ${increment} times this session. Rendering may fail until layers are released.`
          : 'GPU atlas ran out of layers. Rendering may fail until layers are released.'
      });

      // Trigger eviction once we've exhausted capacity twice in a session
      const shouldEvict =
        stats.fullEvents >= 2 &&
        stats.freeLayers === 0 &&
        this.lastEvictedFullEventCount !== stats.fullEvents;

      if (shouldEvict) {
        const evicted = await this.attemptEviction(stats, timestamp);
        if (evicted) {
          this.lastEvictedFullEventCount = stats.fullEvents;
        }
      }
    } else {
      this.lastFullEvents = stats.fullEvents;
    }
  }

  private emitPressureEvent(
    level: PressureLevel,
    stats: AtlasStats,
    timestamp: number,
    reason: AtlasPressureEvent['reason']
  ) {
    const payload: AtlasPressureEvent = { level, stats, timestamp, reason };
    this.eventBus.emit('atlas.pressure', payload);
  }

  private async attemptEviction(
    stats: AtlasStats,
    timestamp: number
  ): Promise<boolean> {
    const now = Date.now();
    if (this.lastEvictionTimestamp && now - this.lastEvictionTimestamp < EVICTION_BACKOFF_MS) {
      const remaining = EVICTION_BACKOFF_MS - (now - this.lastEvictionTimestamp);
      console.warn(
        '[AtlasPressureMonitor] Eviction skipped: backoff active for another',
        `${remaining}ms`
      );
      return false;
    }

    const layerState = useLayerStore.getState();
    const layers = [...layerState.layers];

    if (layers.length === 0) {
      console.warn('[AtlasPressureMonitor] Eviction skipped: no layers loaded');
      return false;
    }

    if (layers.length === 1) {
      console.warn('[AtlasPressureMonitor] Eviction skipped: single layer session');
      return false;
    }

    const candidate = pickAtlasEvictionCandidate(layers);
    if (!candidate) {
      console.warn('[AtlasPressureMonitor] Eviction skipped: no suitable candidate found');
      return false;
    }

    try {
      const layerService = getLayerService();
      await layerService.removeLayer(candidate.id);
      const refreshedStats = await this.api.getAtlasStats().catch(() => null);
      const evictionTimestamp = Date.now();
      this.lastEvictionTimestamp = evictionTimestamp;

      this.eventBus.emit('ui.notification', {
        type: 'warning',
        message: `Freed GPU atlas space by unloading layer "${candidate.name}".`
      });
      this.eventBus.emit('atlas.eviction', {
        layerId: candidate.id,
        stats: refreshedStats ?? stats,
        timestamp: evictionTimestamp,
        reason: 'auto',
        message: `Unloaded layer "${candidate.name}" to relieve atlas pressure.`
      });

      if (refreshedStats) {
        const refreshedTimestamp = Date.now();
        this.emitMetrics(refreshedStats, refreshedTimestamp);
        this.emitPressureEvent(
          'warning',
          refreshedStats,
          refreshedTimestamp,
          'evicted'
        );
        this.lastStats = refreshedStats;
      }

      console.info(
        '[AtlasPressureMonitor] Evicted layer to relieve atlas pressure:',
        candidate.id
      );

      return true;
    } catch (error) {
      console.error('[AtlasPressureMonitor] Failed to evict layer:', error);
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message:
          'Atlas is full and automatic eviction failed. Please remove unused layers manually.'
      });
      return false;
    }
  }
}

let atlasPressureMonitor: AtlasPressureMonitor | null = null;

export function getAtlasPressureMonitor(): AtlasPressureMonitor {
  if (!atlasPressureMonitor) {
    atlasPressureMonitor = new AtlasPressureMonitor();
  }
  return atlasPressureMonitor;
}

export function initializeAtlasPressureMonitor(): AtlasPressureMonitor {
  const monitor = getAtlasPressureMonitor();
  monitor.start();
  return monitor;
}

export function pickAtlasEvictionCandidate(
  layers: LayerInfo[]
): LayerInfo | null {
  if (layers.length === 0) {
    return null;
  }

  const orderOrIndex = (layer: LayerInfo, index: number) =>
    layer.order ?? index;

  const sorted = [...layers].sort(
    (a, b) => orderOrIndex(a, layers.indexOf(a)) - orderOrIndex(b, layers.indexOf(b))
  );

  const hidden = sorted.filter((layer) => !layer.visible);
  if (hidden.length > 0) {
    return hidden[0];
  }

  const nonAnatomical = sorted.filter(
    (layer) => layer.visible && layer.type !== 'anatomical'
  );
  if (nonAnatomical.length > 0) {
    return nonAnatomical[0];
  }

  if (sorted.length > 1) {
    return sorted[1];
  }

  return sorted[0] ?? null;
}
