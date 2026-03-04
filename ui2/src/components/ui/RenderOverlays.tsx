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
        <div className="text-primary font-medium text-xs uppercase tracking-wider">{message}</div>
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
 * Bauhaus Empty State: Pure Geometry & Typography
 * Replaces the organic brain emoji with abstract volumetric representation
 */
export function NoLayersOverlay({ showLoadingHint = true }: NoLayersOverlayProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-muted/10 select-none">
      {/* Wireframe Cube - representing volumetric 3D space */}
      {/* Ultra-thin stroke (0.5px) for drafting pen aesthetic */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
        className="text-foreground/20 mb-6"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>

      {/* Technical specification header */}
      <h3 className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground border-b border-muted-foreground/20 pb-1 mb-2">
        Volume Buffer Empty
      </h3>

      {/* Monospace coordinate-style instruction */}
      {showLoadingHint && (
        <p className="text-[9px] font-mono text-muted-foreground/50 text-center uppercase tracking-wider">
          Awaiting Input Stream<br/>
          Double-click a file or drag &amp; drop
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
    <div className={`absolute ${positionClasses[position]} bg-card border-l-2 border-primary text-foreground text-[10px] uppercase tracking-wider font-medium px-2 py-1`}>
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