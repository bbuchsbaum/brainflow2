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
import { getTimeNavigationService } from '@/services/TimeNavigationService';

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

  if (!value) return null;

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
    fps: 'FPS:',
    gpu: 'GPU:'
  };

  const isClickable = !!onClick;

  return (
    <div
      className={`status-slot${isClickable ? ' cursor-pointer hover:text-blue-300' : ''}`}
      style={{ width: '25ch' }}
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
      
      {/* Time slider for 4D volumes */}
      {has4DVolume && (
        <TimeSlider className="flex-1 max-w-xs" />
      )}
      
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
