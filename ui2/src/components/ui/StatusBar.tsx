/**
 * StatusBar Component
 * Optimized component that renders individual status bar slots
 * Uses StatusBarSlot for performance - only affected slots re-render
 */

import React from 'react';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useLayerStore } from '@/stores/layerStore';
import { StatusBarProgress } from './StatusBarProgress';
import { TimeSlider } from './TimeSlider';

interface StatusBarProps {
  className?: string;
  /** Which slots to show - defaults to all */
  slots?: string[];
  /** Additional right-side content */
  rightContent?: React.ReactNode;
  /** Called when the crosshair slot is clicked */
  onCrosshairClick?: () => void;
}

// Individual slot component that subscribes to Zustand store
const StatusBarSlot = React.memo(({ id, onClick }: { id: string; onClick?: () => void }) => {
  const value = useStatusBarStore(state => state.values[id]);

  if (value === undefined || value === null) return null;

  const getValueClass = (id: string): string => {
    const baseClass = 'status-value';
    switch (id) {
      case 'coordSys':
        return `${baseClass} status-value--coordinate-system`;
      case 'crosshair':
        return `${baseClass} status-value--crosshair`;
      case 'mouse':
        return `${baseClass} status-value--mouse`;
      case 'fps':
        return `${baseClass} status-value--fps`;
      case 'gpu':
        return `${baseClass} status-value--gpu`;
      default:
        return baseClass;
    }
  };

  // Map slot IDs to labels
  const labelMap: Record<string, string> = {
    coordSys: 'Coordinate System:',
    crosshair: 'Crosshair:',
    mouse: 'Mouse:',
    layer: 'Layer:',
    atlas: 'Atlas:',
    fps: 'FPS:',
    gpu: 'GPU:'
  };

  const widthMap: Record<string, string> = {
    coordSys: '27ch',
    crosshair: '34ch',
    mouse: '34ch',
    layer: '34ch',
    atlas: '30ch',
    fps: '12ch',
    gpu: '15ch',
  };

  const slotWidth = widthMap[id] || '22ch';
  const priority = (id === 'fps' || id === 'gpu') ? 'low' : 'normal';
  const isClickable = !!onClick;

  return (
    <div
      className={`status-slot${isClickable ? ' cursor-pointer hover:text-primary' : ''}`}
      style={{ width: slotWidth, minWidth: slotWidth, flex: `0 0 ${slotWidth}` }}
      data-priority={priority}
      onClick={onClick}
      title={isClickable ? 'Click to navigate to coordinate' : undefined}
    >
      <span className="status-label">{labelMap[id] || id}</span>
      <span className={`${getValueClass(id)}${isClickable ? ' hover:underline' : ''}`}>{value}</span>
    </div>
  );
});

StatusBarSlot.displayName = 'StatusBarSlot';

export function StatusBar({
  className = '',
  slots = ['coordSys', 'crosshair', 'mouse', 'layer', 'atlas', 'fps', 'gpu'],
  rightContent,
  onCrosshairClick,
}: StatusBarProps) {
  // Subscribe to layer changes to properly detect 4D volumes
  const layers = useLayerStore(state => state.layers);
  const has4DVolume = React.useMemo(() => {
    try {
      return layers.some(layer => 
        layer.volumeType === 'TimeSeries4D' && 
        layer.timeSeriesInfo && 
        layer.timeSeriesInfo.num_timepoints > 1
      );
    } catch (error) {
      console.warn('Failed to detect 4D volume:', error);
      return false;
    }
  }, [layers]);

  return (
    <div className={`status-bar ${className}`}>
      {slots.map(id => (
        <StatusBarSlot
          key={id}
          id={id}
          onClick={id === 'crosshair' ? onCrosshairClick : undefined}
        />
      ))}
      
      {/* Time slider always visible; disabled when no 4D */}
      <TimeSlider className="flex-1 max-w-sm" disabled={!has4DVolume} />
      
      {/* Progress indicator */}
      <StatusBarProgress />
      
      {rightContent && (
        <div className="status-bar__right">
          {rightContent}
        </div>
      )}
    </div>
  );
}
