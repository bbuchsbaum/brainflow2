/**
 * Volume-keyed UI caches released when a volume is unloaded (QA 2026-10-30
 * F9: WebView memory kept growing over load/remove cycles). Volume ids are
 * fresh per load, so a cache keyed by them that is never cleared grows with
 * every cycle. Layer-keyed caches release on `layer.removed` instead.
 */
import { clearNonzeroBbox } from '@/services/mosaic/brainBounds';
import { getTemporalHeatmapService } from '@/services/TemporalHeatmapService';

export function releaseVolumeCaches(volumeId: string): void {
  clearNonzeroBbox(volumeId);
  getTemporalHeatmapService().clearVolume(volumeId);
}
