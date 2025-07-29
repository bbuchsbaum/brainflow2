/**
 * SliceViewComparison Component
 * 
 * Test component that shows original SliceView and refactored version side by side
 * for visual comparison and testing.
 */

import React from 'react';
import { SliceView } from './SliceView';
import { SliceViewRefactored } from './SliceViewRefactored';

interface SliceViewComparisonProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
}

export function SliceViewComparison({ viewId, width, height }: SliceViewComparisonProps) {
  return (
    <div className="flex h-full">
      <div className="flex-1 border-r border-gray-600">
        <div className="bg-gray-800 text-white text-xs p-1 text-center">Original</div>
        <SliceView viewId={viewId} width={width} height={height} />
      </div>
      <div className="flex-1">
        <div className="bg-gray-800 text-white text-xs p-1 text-center">Refactored</div>
        <SliceViewRefactored viewId={viewId} width={width} height={height} />
      </div>
    </div>
  );
}