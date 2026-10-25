/**
 * RenderOverlays Component
 * 
 * Shared overlay components for rendering states (loading, error, etc.)
 * Extracted from SliceView and RenderCell to reduce duplication
 */

import React from 'react';

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="text-white text-sm">{message}</div>
    </div>
  );
}

interface ErrorOverlayProps {
  error: string | Error | null;
}

export function ErrorOverlay({ error }: ErrorOverlayProps) {
  if (!error) return null;
  
  const errorMessage = error instanceof Error ? error.message : error;
  
  return (
    <div className="absolute inset-0 bg-red-500 bg-opacity-75 flex items-center justify-center">
      <div className="text-white text-sm text-center p-2">
        {errorMessage}
      </div>
    </div>
  );
}

interface DragOverlayProps {
  message?: string;
}

export function DragOverlay({ message = 'Drop file to load' }: DragOverlayProps) {
  return (
    <div className="absolute inset-0 bg-primary/15 pointer-events-none flex items-center justify-center">
      <div className="bg-card px-4 py-2 shadow-lg border border-primary/30">
        <div className="text-primary font-medium text-[12px]">{message}</div>
      </div>
    </div>
  );
}

interface LabelOverlayProps {
  label: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export function LabelOverlay({ label, position = 'bottom-left' }: LabelOverlayProps) {
  const positionClasses = {
    'top-left': 'top-1 left-1',
    'top-right': 'top-1 right-1',
    'bottom-left': 'bottom-1 left-1',
    'bottom-right': 'bottom-1 right-1'
  };
  
  return (
    <div className={`absolute ${positionClasses[position]} text-xs text-white bg-black/50 px-1`}>
      {label}
    </div>
  );
}

interface CoordinateDisplayProps {
  coordinates: [number, number, number];
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export function CoordinateDisplay({ coordinates, position = 'top-left' }: CoordinateDisplayProps) {
  const positionClasses = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2'
  };
  
  const formatCoordinate = (coord: [number, number, number]) => {
    return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
  };
  
  return (
    <div className={`absolute ${positionClasses[position]} bg-black bg-opacity-75 text-white text-xs px-2 py-1`}>
      {formatCoordinate(coordinates)}
    </div>
  );
}

interface NoLayersOverlayProps {
  showLoadingHint?: boolean;
}

/**
 * Text-only empty state (Workstation restyle): one sentence plus a mono hint,
 * no illustration.
 */
export function NoLayersOverlay({ showLoadingHint = true }: NoLayersOverlayProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none select-none text-center">
      <p
        className="text-[12px] font-medium"
        style={{ color: "var(--bf-text-secondary)" }}
      >
        No volume loaded
      </p>
      {showLoadingHint && (
        <p className="text-[11px] font-mono text-muted-foreground">
          Double-click a file in Files, or drop one here
        </p>
      )}
    </div>
  );
}

interface LoadingVolumeOverlayProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export function LoadingVolumeOverlay({ position = 'top-right' }: LoadingVolumeOverlayProps) {
  const positionClasses = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2'
  };

  return (
    <div className={`absolute ${positionClasses[position]} bg-card border-l-2 border-primary text-foreground font-mono text-[11px] px-2 py-1`}>
      Loading volume…
    </div>
  );
}

// Composite overlay component that can show multiple overlays at once
interface RenderOverlaysProps {
  isLoading?: boolean;
  loadingMessage?: string;
  error?: string | Error | null;
  isDragging?: boolean;
  dragMessage?: string;
  label?: string;
  labelPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  children?: React.ReactNode;
}

export function RenderOverlays({
  isLoading,
  loadingMessage,
  error,
  isDragging,
  dragMessage,
  label,
  labelPosition,
  children
}: RenderOverlaysProps) {
  return (
    <>
      {isLoading && <LoadingOverlay message={loadingMessage} />}
      {error && <ErrorOverlay error={error} />}
      {isDragging && <DragOverlay message={dragMessage} />}
      {label && <LabelOverlay label={label} position={labelPosition} />}
      {children}
    </>
  );
}