/**
 * InlineProgress - Small inline progress indicator for contextual use
 * Shows loading state within existing UI elements
 */

import React from 'react';

interface InlineProgressProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function InlineProgress({ 
  size = 'sm',
  className = ''
}: InlineProgressProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5', 
    lg: 'w-6 h-6'
  };
  
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg 
        className={`animate-spin ${sizeClasses[size]}`}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="2"
          opacity="0.25"
        />
        <path 
          d="M12 2a10 10 0 0 1 10 10" 
          stroke="var(--layer-accent)" 
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}