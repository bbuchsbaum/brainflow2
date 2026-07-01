/**
 * TimeSlider Component
 * A micro-slider for time navigation in the status bar.
 * Extremely minimal height (1px track) to preserve screen real estate.
 *
 * The timepoint is GLOBAL: every loaded 4D layer scrubs together. This
 * component only drives/reflects that single shared timepoint.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { throttle } from 'lodash-es';
import { Pause, Play } from 'lucide-react';
import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { useEvent } from '@/events/EventBus';
import { getEventBus } from '@/events/EventBus';
import { getPlaybackService, PLAYBACK_SPEEDS } from '@/services/PlaybackService';

interface TimeSliderProps {
  className?: string;
  disabled?: boolean;
}

/** Format seconds as mm:ss (e.g. 74.8 → "1:14"). */
function formatElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function TimeSlider({ className = '', disabled = false }: TimeSliderProps) {
  const timeNav = useTimeNavigation();
  const timeInfo = timeNav.getTimeInfo();
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => getPlaybackService().getSpeed());
  const [localTimepoint, setLocalTimepoint] = useState<number | null>(null); // For immediate UI feedback
  const sliderRef = useRef<HTMLDivElement>(null);
  const eventBus = getEventBus();

  const isDisabled = disabled || !timeInfo;

  // Clear local override when time changes externally
  useEffect(() => {
    setLocalTimepoint(null);
  }, [timeInfo?.currentTimepoint]);

  // Reflect authoritative playback state emitted by PlaybackService.
  // Memoise the handler so useEvent doesn't resubscribe on every render.
  const handlePlaybackStateChanged = useCallback((data: { playing: boolean }) => {
    setIsPlaying(data.playing);
  }, []);
  useEvent('playback.stateChanged', handlePlaybackStateChanged);

  // Throttled backend update - max 60fps (16ms)
  const throttledSetTimepoint = useMemo(
    () =>
      throttle((timepoint: number) => {
        timeNav.setTimepoint(timepoint);
        setLocalTimepoint(null); // Clear local override after backend update
      }, 16),
    [timeNav],
  );

  // Cleanup throttled function on unmount
  useEffect(() => {
    return () => {
      throttledSetTimepoint.cancel();
    };
  }, [throttledSetTimepoint]);

  // Toggle playback via the authoritative PlaybackService.
  const handleTogglePlayback = useCallback(() => {
    if (isDisabled) return;
    eventBus.emit('playback.toggle', {});
  }, [eventBus, isDisabled]);

  // Cycle 1× → 2× → 4× → 1×, keeping PlaybackService authoritative.
  const handleCycleSpeed = useCallback(() => {
    if (isDisabled) return;
    const playback = getPlaybackService();
    const current = playback.getSpeed();
    const idx = PLAYBACK_SPEEDS.indexOf(current as (typeof PLAYBACK_SPEEDS)[number]);
    const next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    playback.setSpeed(next);
    setSpeed(next);
  }, [isDisabled]);

  // Ctrl/Cmd+click on the track also toggles playback (legacy affordance).
  const handlePlayPause = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        eventBus.emit('playback.toggle', {});
      }
    },
    [eventBus],
  );

  // Handle scrubbing
  const handleScrub = useCallback(
    (clientX: number) => {
      if (!sliderRef.current || !timeInfo || isDisabled) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const timepoint = Math.round(percentage * (timeInfo.totalTimepoints - 1));

      // Immediate UI feedback
      setLocalTimepoint(timepoint);

      // Throttled backend update
      throttledSetTimepoint(timepoint);
    },
    [timeInfo, isDisabled, throttledSetTimepoint],
  );

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Check for play/pause command
      if (e.ctrlKey || e.metaKey) {
        handlePlayPause(e);
        return;
      }

      setIsDragging(true);
      handleScrub(e.clientX);

      // Add document-level listeners for drag
      const handleMouseMove = (e: MouseEvent) => {
        handleScrub(e.clientX);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [handleScrub, handlePlayPause],
  );

  const effectiveTimeInfo = isDisabled ? null : timeInfo;

  // Use local timepoint during dragging for immediate feedback
  const totalTimepoints = effectiveTimeInfo?.totalTimepoints ?? 1;
  const denominator = Math.max(1, totalTimepoints - 1);
  const displayTimepoint =
    effectiveTimeInfo && denominator > 0
      ? Math.min(denominator, Math.max(0, localTimepoint ?? effectiveTimeInfo.currentTimepoint))
      : 0;
  const percentage = (displayTimepoint / denominator) * 100;

  // Frame readout (current/total) plus elapsed mm:ss when TR is known.
  // Falls back to frame index only when TR is null/0.
  const timeDisplay = useMemo(() => {
    if (isDisabled || !effectiveTimeInfo) {
      return 'Time ⏱ unavailable';
    }
    const frame = displayTimepoint;
    const lastFrame = denominator;
    const tr = effectiveTimeInfo.tr;
    if (tr && tr > 0) {
      const elapsed = formatElapsed(frame * tr);
      const total = formatElapsed(lastFrame * tr);
      return `${frame}/${lastFrame} · ${elapsed} / ${total}`;
    }
    return `${frame}/${lastFrame}`;
  }, [isDisabled, effectiveTimeInfo, displayTimepoint, denominator]);

  const handlePrevious = useCallback(() => {
    if (isDisabled) return;
    timeNav.previousTimepoint();
  }, [isDisabled, timeNav]);

  const handleNext = useCallback(() => {
    if (isDisabled) return;
    timeNav.nextTimepoint();
  }, [isDisabled, timeNav]);

  // Keyboard shortcuts: ←/→ step, Shift+←/→ jump 5 TRs
  useEffect(() => {
    if (isDisabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable =
          target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (isEditable) {
          return;
        }
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.shiftKey) {
          timeNav.jumpTimepoints(-5);
        } else {
          timeNav.previousTimepoint();
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) {
          timeNav.jumpTimepoints(5);
        } else {
          timeNav.nextTimepoint();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDisabled, timeNav]);

  const transportClass =
    'inline-flex h-6 w-6 items-center justify-center rounded text-[11px] ' +
    'text-[var(--bf-text-secondary)] bg-[var(--bf-bg-input)] border border-[var(--bf-border-subtle)] ' +
    'transition-colors hover:bg-[var(--bf-bg-hover)] hover:text-[var(--bf-text-primary)] ' +
    'disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none ' +
    'focus-visible:ring-1 focus-visible:ring-[var(--bf-border-focus)]';

  return (
    <div className={`flex items-center gap-2 px-2 ${className}`} aria-disabled={isDisabled}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={transportClass}
          onClick={handlePrevious}
          disabled={isDisabled}
          aria-label="Previous timepoint"
          title="Previous timepoint (←)"
        >
          ‹
        </button>

        {/* Play / Pause — authoritative toggle via PlaybackService */}
        <button
          type="button"
          className={transportClass}
          onClick={handleTogglePlayback}
          disabled={isDisabled}
          aria-label={isPlaying ? 'Pause playback' : 'Play'}
          aria-pressed={isPlaying}
          title={
            isDisabled
              ? 'Load a 4D volume to enable playback'
              : isPlaying
                ? 'Pause (Space)'
                : 'Play (Space)'
          }
        >
          {isPlaying ? (
            <Pause className="h-3 w-3" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play className="h-3 w-3" fill="currentColor" strokeWidth={0} />
          )}
        </button>

        <button
          type="button"
          className={transportClass}
          onClick={handleNext}
          disabled={isDisabled}
          aria-label="Next timepoint"
          title="Next timepoint (→)"
        >
          ›
        </button>

        {/* Speed multiplier — cycles 1× / 2× / 4× */}
        <button
          type="button"
          className={`${transportClass} w-7 font-mono tabular-nums`}
          onClick={handleCycleSpeed}
          disabled={isDisabled}
          aria-label={`Playback speed ${speed}×`}
          title="Cycle playback speed (1× / 2× / 4×)"
        >
          {speed}×
        </button>
      </div>

      {/* Time display */}
      <span
        className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--bf-text-muted)]"
        data-testid="time-slider-readout"
      >
        {timeDisplay}
      </span>

      {/* Micro-slider */}
      <div
        ref={sliderRef}
        data-testid="time-slider-track"
        className={`relative flex-1 h-4 group ${isDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
        onMouseDown={isDisabled ? undefined : handleMouseDown}
        title={
          isDisabled
            ? 'Load a 4D volume to enable time navigation'
            : `${isPlaying ? 'Playing' : 'Paused'} - Click to scrub, Ctrl/Cmd+Click to ${isPlaying ? 'pause' : 'play'} • Use ←/→ to step, Shift+←/→ to jump`
        }
      >
        {/* Track (1px high, expands on hover) */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full">
          <div
            className={`
            w-full bg-[var(--bf-border)] transition-all duration-150
            ${isDragging && !isDisabled ? 'h-2' : 'h-px group-hover:h-1'}
          `}
          >
            {/* Progress fill */}
            <div
              className={`
                h-full transition-colors duration-150
                ${isPlaying ? 'bg-[var(--bf-success)]' : 'bg-[var(--bf-accent)]'}
              `}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {/* Invisible hit area for easier clicking */}
        <div className="absolute inset-0" />

        {/* Thumb (only visible on hover or drag) */}
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 -translate-x-1/2
            w-2 h-2 rounded-full transition-all duration-150
            ${isPlaying ? 'bg-[var(--bf-success)]' : 'bg-[var(--bf-accent)]'}
            ${isDragging && !isDisabled ? 'opacity-100 scale-125' : 'opacity-0 group-hover:opacity-100'}
          `}
          style={{ left: `${percentage}%` }}
          data-testid="time-slider-thumb"
        />
      </div>
    </div>
  );
}
