/**
 * StatusBarSlot Component
 * Individual slot component for performance optimization
 * Only re-renders when its specific data changes
 */

import React from 'react';
import { useStatusSlot } from '@/contexts/StatusContext';

// Get CSS class for value based on slot ID
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

interface StatusBarSlotProps {
  id: string;
}

export const StatusBarSlot = React.memo(({ id }: StatusBarSlotProps) => {
  const slot = useStatusSlot(id);

  if (!slot) {
    return null;
  }

  return (
    <div 
      className="status-slot"
      style={{ 
        width: slot.width,
        textAlign: slot.align || 'left'
      }}
    >
      <span className="status-label">{slot.label}</span>
      <span className={getValueClass(id)}>
        {slot.value}
      </span>
    </div>
  );
});

StatusBarSlot.displayName = 'StatusBarSlot';