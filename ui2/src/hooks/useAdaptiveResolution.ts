/**
 * useAdaptiveResolution
 *
 * Reduces render resolution during active interaction (layout drag, slider drag,
 * window/level adjustment) for faster feedback, then re-renders at full resolution
 * after a short idle debounce.
 *
 * The canvas stays at full size — only the backend render target shrinks.
 * The browser upscales the smaller image smoothly via CSS image-rendering.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutDragStore } from '@/stores/layoutDragStore';

/** Default quality factor during interaction (0.5 = half resolution) */
const DEFAULT_INTERACTION_QUALITY = 0.5;
/** Debounce before switching back to full resolution (ms) */
const IDLE_DEBOUNCE_MS = 200;

export interface AdaptiveResolutionOptions {
  /** Base dimensions at full quality */
  width: number;
  height: number;
  /** Quality factor during interaction (0.25–1.0, default 0.5) */
  interactionQuality?: number;
  /** Whether adaptive resolution is enabled (default true) */
  enabled?: boolean;
}

export interface AdaptiveResolutionResult {
  /** Dimensions to request from the render backend */
  renderWidth: number;
  renderHeight: number;
  /** Whether currently rendering at reduced quality */
  isReduced: boolean;
  /** Signal that an interaction started (call from onMouseDown, etc.) */
  beginInteraction: () => void;
  /** Signal that an interaction ended (call from onMouseUp, etc.) */
  endInteraction: () => void;
}

export function useAdaptiveResolution({
  width,
  height,
  interactionQuality = DEFAULT_INTERACTION_QUALITY,
  enabled = true,
}: AdaptiveResolutionOptions): AdaptiveResolutionResult {
  const [isReduced, setIsReduced] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localInteracting = useRef(false);

  // Subscribe to layout drag state
  const layoutDragging = useLayoutDragStore((s) => s.isDragging);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const beginInteraction = useCallback(() => {
    if (!enabled) return;
    localInteracting.current = true;
    clearIdleTimer();
    setIsReduced(true);
  }, [enabled, clearIdleTimer]);

  const endInteraction = useCallback(() => {
    localInteracting.current = false;
    if (!enabled) return;
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      // Only restore if no other interaction source is active
      if (!localInteracting.current && !useLayoutDragStore.getState().isDragging) {
        setIsReduced(false);
      }
    }, IDLE_DEBOUNCE_MS);
  }, [enabled, clearIdleTimer]);

  // React to layout drag state changes
  useEffect(() => {
    if (!enabled) return;
    if (layoutDragging) {
      clearIdleTimer();
      setIsReduced(true);
    } else {
      // Layout drag ended — debounce back to full res
      idleTimerRef.current = setTimeout(() => {
        if (!localInteracting.current) {
          setIsReduced(false);
        }
      }, IDLE_DEBOUNCE_MS);
    }
    return clearIdleTimer;
  }, [layoutDragging, enabled, clearIdleTimer]);

  // Cleanup on unmount
  useEffect(() => clearIdleTimer, [clearIdleTimer]);

  const quality = enabled && isReduced ? Math.max(0.25, Math.min(1, interactionQuality)) : 1;
  const renderWidth = Math.max(1, Math.round(width * quality));
  const renderHeight = Math.max(1, Math.round(height * quality));

  return {
    renderWidth,
    renderHeight,
    isReduced,
    beginInteraction,
    endInteraction,
  };
}
