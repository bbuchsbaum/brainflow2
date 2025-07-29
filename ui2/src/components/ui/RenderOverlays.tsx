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
    <div className="absolute inset-0 bg-blue-500 bg-opacity-20 pointer-events-none flex items-center justify-center">
      <div className="bg-white rounded-lg px-4 py-2 shadow-lg">
        <div className="text-blue-600 font-medium">{message}</div>
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
    <div className={`absolute ${positionClasses[position]} text-xs text-white bg-black/50 px-1 rounded`}>
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
    <div className={`absolute ${positionClasses[position]} bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded`}>
      {formatCoordinate(coordinates)}
    </div>
  );
}

interface NoLayersOverlayProps {
  showLoadingHint?: boolean;
}

export function NoLayersOverlay({ showLoadingHint = true }: NoLayersOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-gray-400 text-center">
        <div className="text-4xl mb-2">🧠</div>
        <div className="text-sm">No volumes loaded</div>
        {showLoadingHint && (
          <div className="text-xs mt-1 opacity-75">Double-click a file or drag & drop</div>
        )}
      </div>
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
    <div className={`absolute ${positionClasses[position]} bg-yellow-500 bg-opacity-90 text-white text-xs px-2 py-1 rounded animate-pulse`}>
      Loading volume...
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