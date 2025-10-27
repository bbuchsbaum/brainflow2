/**
 * CollapsibleSection Component
 * A reusable component for creating collapsible sections with smooth animations
 */

import React, { useState, ReactNode, ComponentType } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

interface CollapsibleSectionProps {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon: Icon,
  children,
  defaultExpanded = false,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("border-b last:border-b-0", className)}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-0 py-3 text-sm font-medium hover:bg-muted/30 transition-colors rounded"
      >
        {/* Chevron Icon */}
        <div className="transition-transform duration-200">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        
        {/* Section Icon */}
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        
        {/* Title */}
        <span className="flex-1 text-left">{title}</span>
      </button>

      {/* Content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          isExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="pb-4 pl-6">
          {children}
        </div>
      </div>
    </div>
  );
};