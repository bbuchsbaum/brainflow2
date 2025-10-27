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
}

export function TimeSlider({ className = '' }: TimeSliderProps) {
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
  useEvent('playback.stateChanged', (data: { playing: boolean }) => {
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
      eventBus.emit('playback.toggle');
    }
  }, [eventBus]);

  // Handle scrubbing
  const handleScrub = useCallback((clientX: number) => {
    if (!sliderRef.current || !timeInfo) return;

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

  if (!timeInfo) {
    return null; // Don't show if no 4D volume
  }

  // Use local timepoint during dragging for immediate feedback
  const displayTimepoint = localTimepoint ?? timeInfo.currentTimepoint;
  const percentage = (displayTimepoint / (timeInfo.totalTimepoints - 1)) * 100;
  
  // Format time display with local override if available
  const timeDisplay = localTimepoint !== null 
    ? `TR ${localTimepoint} | ${((localTimepoint * (timeInfo.tr || 1.0))/60).toFixed(1)} min`
    : timeNav.formatStatusDisplay();

  return (
    <div className={`flex items-center gap-2 px-2 ${className}`}>
      {/* Time display */}
      <span className="text-xs text-gray-400 font-mono whitespace-nowrap">
        {timeDisplay}
      </span>

      {/* Micro-slider */}
      <div 
        ref={sliderRef}
        data-testid="time-slider-track"
        className="relative flex-1 h-4 cursor-pointer group"
        onMouseDown={handleMouseDown}
        title={`${isPlaying ? 'Playing' : 'Paused'} - Click to scrub, Ctrl/Cmd+Click to ${isPlaying ? 'pause' : 'play'}`}
      >
        {/* Track (1px high, expands on hover) */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full">
          <div className={`
            w-full bg-gray-700 transition-all duration-150
            ${isDragging ? 'h-2' : 'h-px group-hover:h-1'}
          `}>
            {/* Progress fill */}
            <div 
              className={`
                h-full transition-colors duration-150
                ${isPlaying ? 'bg-green-500' : 'bg-blue-500'}
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
            ${isPlaying ? 'bg-green-400' : 'bg-blue-400'}
            ${isDragging ? 'opacity-100 scale-125' : 'opacity-0 group-hover:opacity-100'}
          `}
          style={{ left: `${percentage}%` }}
          data-testid="time-slider-thumb"
        />
      </div>

      {/* Play/pause indicator */}
      {isPlaying && (
        <span className="text-xs text-green-500 animate-pulse">▶</span>
      )}
    </div>
  );
}
