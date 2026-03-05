/**
 * TimeSlider Component
 * A micro-slider for time navigation in the status bar
 * Extremely minimal height (1px track) to preserve screen real estate
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { throttle } from 'lodash-es';
import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { useEvent } from '@/events/EventBus';
import { getEventBus } from '@/events/EventBus';

interface TimeSliderProps {
  className?: string;
  disabled?: boolean;
}

export function TimeSlider({ className = '', disabled = false }: TimeSliderProps) {
  const timeNav = useTimeNavigation();
  const timeInfo = timeNav.getTimeInfo();
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [localTimepoint, setLocalTimepoint] = useState<number | null>(null); // For immediate UI feedback
  const sliderRef = useRef<HTMLDivElement>(null);
  const eventBus = getEventBus();

  // Clear local override when time changes externally
  useEffect(() => {
    setLocalTimepoint(null);
  }, [timeInfo?.currentTimepoint]);

  // Update playing state
  useEvent('playback.stateChanged', (data) => {
    setIsPlaying(data.playing);
  });

  // Throttled backend update - max 60fps (16ms)
  const throttledSetTimepoint = useMemo(
    () => throttle((timepoint: number) => {
      timeNav.setTimepoint(timepoint);
      setLocalTimepoint(null); // Clear local override after backend update
    }, 16),
    [timeNav]
  );

  // Cleanup throttled function on unmount
  useEffect(() => {
    return () => {
      throttledSetTimepoint.cancel();
    };
  }, [throttledSetTimepoint]);

  // Handle play/pause toggle
  const handlePlayPause = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('playback.toggle', {});
    }
  }, [eventBus]);

  // Handle scrubbing
  const handleScrub = useCallback((clientX: number) => {
    if (!sliderRef.current || !timeInfo || isDisabled) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const timepoint = Math.round(percentage * (timeInfo.totalTimepoints - 1));
    
    // Immediate UI feedback
    setLocalTimepoint(timepoint);
    
    // Throttled backend update
    throttledSetTimepoint(timepoint);
  }, [timeInfo, throttledSetTimepoint]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [handleScrub, handlePlayPause]);

  const isDisabled = disabled || !timeInfo;
  const effectiveTimeInfo = isDisabled ? null : timeInfo;

  // Use local timepoint during dragging for immediate feedback
  const totalTimepoints = effectiveTimeInfo?.totalTimepoints ?? 1;
  const denominator = Math.max(1, totalTimepoints - 1);
  const displayTimepoint =
    effectiveTimeInfo && denominator > 0
      ? Math.min(
          denominator,
          Math.max(0, localTimepoint ?? effectiveTimeInfo.currentTimepoint)
        )
      : 0;
  const percentage = (displayTimepoint / denominator) * 100;

  // Format time display with local override if available
  const timeDisplay = isDisabled
    ? 'Time ⏱ unavailable'
    : localTimepoint !== null
      ? `TR ${localTimepoint} | ${((localTimepoint * (effectiveTimeInfo!.tr || 1.0)) / 60).toFixed(1)} min`
      : timeNav.formatStatusDisplay() ?? `TR ${displayTimepoint}`;

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
          target.isContentEditable ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT';
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

  return (
    <div className={`flex items-center gap-2 px-2 ${className}`} aria-disabled={isDisabled}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="px-2 py-1 text-xs text-foreground bg-muted/80 rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
          onClick={handlePrevious}
          disabled={isDisabled}
          aria-label="Previous timepoint"
        >
          ‹
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs text-foreground bg-muted/80 rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
          onClick={handleNext}
          disabled={isDisabled}
          aria-label="Next timepoint"
        >
          ›
        </button>
      </div>

      {/* Time display */}
      <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
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
          <div className={`
            w-full bg-muted transition-all duration-150
            ${isDragging && !isDisabled ? 'h-2' : 'h-px group-hover:h-1'}
          `}>
            {/* Progress fill */}
            <div 
              className={`
                h-full transition-colors duration-150
                ${isPlaying ? 'bg-[var(--app-success)]' : 'bg-primary'}
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
            ${isPlaying ? 'bg-[var(--app-success)]' : 'bg-primary'}
            ${isDragging && !isDisabled ? 'opacity-100 scale-125' : 'opacity-0 group-hover:opacity-100'}
          `}
          style={{ left: `${percentage}%` }}
          data-testid="time-slider-thumb"
        />
      </div>

      {/* Play/pause indicator */}
      {isPlaying && !isDisabled && (
        <span className="text-xs text-[var(--app-success)] animate-pulse">▶</span>
      )}
    </div>
  );
}
