/**
 * PlaybackService
 *
 * Owns the authoritative 4D playback loop. Listens for `playback.toggle`
 * (emitted by the TimeSlider play button, Ctrl/Cmd+click, and the Space
 * keyboard shortcut) and drives a requestAnimationFrame loop that advances
 * the global timepoint via TimeNavigationService.
 *
 * Playback LOOPS: TimeNavigationService.nextTimepoint() clamps at the end of
 * the series, so we compute the wrapped index ourselves and call setTimepoint.
 *
 * The service is the single source of truth for `isPlaying` and `speed`; it
 * emits `playback.stateChanged` on every start/stop so UI affordances (the
 * TimeSlider pulse / play-pause button) reflect authoritative state.
 */

import { getEventBus } from '@/events/EventBus';
import { getTimeNavigationService } from '@/services/TimeNavigationService';

/** Frame interval used when the 4D volume has no usable TR (seconds). */
const FALLBACK_TICK_MS = 100;
/** Supported playback speed multipliers, cycled by the UI. */
export const PLAYBACK_SPEEDS = [1, 2, 4] as const;

class PlaybackService {
  private static instance: PlaybackService;
  private eventBus = getEventBus();

  private unsubscribeToggle: (() => void) | null = null;
  private rafId: number | null = null;
  private lastTick = 0;
  private isPlaying = false;
  private speed = 1;

  private constructor() {
    console.log('[PlaybackService] Initialized');
  }

  static getInstance(): PlaybackService {
    if (!PlaybackService.instance) {
      PlaybackService.instance = new PlaybackService();
    }
    return PlaybackService.instance;
  }

  /**
   * Begin listening for `playback.toggle`. Idempotent — calling start() while
   * already started is a no-op.
   */
  start(): void {
    if (this.unsubscribeToggle) {
      return;
    }
    this.unsubscribeToggle = this.eventBus.on('playback.toggle', () => {
      this.toggle();
    });
  }

  /**
   * Tear down: cancel any running loop and unsubscribe from the event bus.
   */
  stop(): void {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    this.stopLoop();
    if (this.unsubscribeToggle) {
      this.unsubscribeToggle();
      this.unsubscribeToggle = null;
    }
    if (wasPlaying) {
      this.eventBus.emit('playback.stateChanged', { playing: false });
    }
  }

  /** Whether the playback loop is currently running. */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /** Current playback speed multiplier. */
  getSpeed(): number {
    return this.speed;
  }

  /**
   * Set the playback speed multiplier. Takes effect on the next tick when
   * playing (tick interval is recomputed each frame).
   */
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) {
      return;
    }
    this.speed = speed;
  }

  /** Toggle play/pause. */
  toggle(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Start playback if a 4D volume with more than one timepoint is loaded.
   * No-op otherwise.
   */
  play(): void {
    if (this.isPlaying) {
      return;
    }
    if (!this.canPlay()) {
      return;
    }
    this.isPlaying = true;
    this.lastTick = 0;
    this.startLoop();
    this.eventBus.emit('playback.stateChanged', { playing: true });
  }

  /** Stop playback. Idempotent. */
  pause(): void {
    if (!this.isPlaying) {
      return;
    }
    this.isPlaying = false;
    this.stopLoop();
    this.eventBus.emit('playback.stateChanged', { playing: false });
  }

  private canPlay(): boolean {
    const timeNav = getTimeNavigationService();
    if (!timeNav.has4DVolume()) {
      return false;
    }
    const info = timeNav.getTimeInfo();
    return !!info && info.totalTimepoints > 1;
  }

  private startLoop(): void {
    if (this.rafId != null || typeof requestAnimationFrame !== 'function') {
      return;
    }
    const step = (now: number) => {
      // Re-validate every frame: auto-stop if the 4D volume went away.
      const timeNav = getTimeNavigationService();
      const info = timeNav.getTimeInfo();
      if (!info || info.totalTimepoints <= 1) {
        this.pause();
        return;
      }

      const tr = info.tr;
      const baseTickMs = tr && tr > 0 ? tr * 1000 : FALLBACK_TICK_MS;
      const tickMs = baseTickMs / this.speed;

      if (now - this.lastTick >= tickMs) {
        this.lastTick = now;
        const next = (info.currentTimepoint + 1) % info.totalTimepoints;
        timeNav.setTimepoint(next);
      }

      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopLoop(): void {
    if (this.rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.lastTick = 0;
  }
}

export function getPlaybackService(): PlaybackService {
  return PlaybackService.getInstance();
}

export type { PlaybackService };
