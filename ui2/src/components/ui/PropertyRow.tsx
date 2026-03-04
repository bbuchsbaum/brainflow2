/**
 * PropertyRow Component
 * Displays a label/value pair in the "Technical Blueprint" style
 * Used for instrument readouts and data displays
 */

import React from 'react';
import { cn } from '@/utils/cn';

interface PropertyRowProps {
  label: string;
  value: React.ReactNode;
  /** Use monospace font for numeric/data values */
  mono?: boolean;
  /** Truncate long values */
  truncate?: boolean;
  /** Maximum width for the value (e.g., '120px', '50%') */
  maxValueWidth?: string;
  className?: string;
}

export function PropertyRow({
  label,
  value,
  mono = false,
  truncate = false,
  maxValueWidth,
  className
}: PropertyRowProps) {
  return (
    <div className={cn('flex justify-between items-baseline gap-4', className)}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold shrink-0">
        {label}
      </span>
      <span
        className={cn(
          'text-xs text-foreground',
          mono ? 'font-mono' : 'font-medium',
          truncate && 'truncate'
        )}
        style={maxValueWidth ? { maxWidth: maxValueWidth } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * PropertyBox Component
 * Container for a group of PropertyRows with the "Paper" contrast background
 */
interface PropertyBoxProps {
  children: React.ReactNode;
  className?: string;
}

export function PropertyBox({ children, className }: PropertyBoxProps) {
  return (
    <div className={cn(
      'bg-muted/30 border border-border p-3 space-y-2',
      className
    )}>
      {children}
    </div>
  );
}
