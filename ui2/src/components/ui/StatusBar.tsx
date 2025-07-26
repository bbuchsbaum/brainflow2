/**
 * StatusBar Component
 * Optimized component that renders individual status bar slots
 * Uses StatusBarSlot for performance - only affected slots re-render
 */

import React from 'react';
import { useStatus } from '@/contexts/StatusContext';
import { StatusBarSlot } from './StatusBarSlot';
import { StatusBarProgress } from './StatusBarProgress';

interface StatusBarProps {
  className?: string;
  /** Which slots to show - defaults to all */
  slots?: string[];
  /** Additional right-side content */
  rightContent?: React.ReactNode;
}

export function StatusBar({ 
  className = '', 
  slots,
  rightContent 
}: StatusBarProps) {
  const statusState = useStatus();
  
  // Get visible slot IDs, filtering if needed
  const visibleSlotIds = Object.keys(statusState)
    .filter(id => !slots || slots.includes(id));
  
  return (
    <div className={`status-bar ${className}`}>
      {visibleSlotIds.map(id => (
        <StatusBarSlot key={id} id={id} />
      ))}
      
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