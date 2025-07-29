/**
 * RenderCell Component
 * 
 * A basic building block for displaying rendered images from the backend.
 * This component is now a thin wrapper around SliceRenderer for backward compatibility.
 * 
 * @deprecated Use SliceRenderer directly for new code
 */

import React from 'react';
import { SliceRenderer } from './SliceRenderer';

interface RenderCellProps {
  width: number;
  height: number;
  tag?: string; // Optional tag to filter render events
  onImageReceived?: (imageBitmap: ImageBitmap) => void;
  className?: string;
  showLabel?: boolean;
  label?: string;
}

export function RenderCell({ 
  width, 
  height, 
  tag, 
  onImageReceived,
  className = '',
  showLabel = false,
  label = ''
}: RenderCellProps) {
  // Delegate to SliceRenderer
  return (
    <SliceRenderer
      width={width}
      height={height}
      tag={tag}
      onImageReceived={onImageReceived}
      className={className}
      showLabel={showLabel}
      label={label}
    />
  );
}