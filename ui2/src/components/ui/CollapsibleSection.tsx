/**
 * CollapsibleSection Component
 * A clean text-based collapsible trigger following the "Instrument Control" aesthetic
 * Replaces heavy bordered buttons with minimal header styling
 */

import React, { useState, ReactNode, ComponentType } from 'react';
import { ChevronRight } from 'lucide-react';
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
    <div className={cn("text-foreground", className)}>
      {/* Header - Clean text trigger, no border box */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full bf-control-md flex items-center justify-between px-1 py-1 hover:bg-muted/50 transition-colors group text-foreground rounded-appsm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <div className="flex items-center gap-2">
          {/* Section Icon */}
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}

          {/* Title - Blueprint style */}
          <span className="bf-role-section text-foreground/90">
            <span className="text-accent/60 mr-1 font-normal" aria-hidden="true">{'\u2013'}</span>
            {title}
          </span>
        </div>

        {/* Chevron - rotates on open */}
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {/* Content - tight padding for Bauhaus density */}
      {/* Note: We use a wrapper with overflow-hidden for the expand/collapse animation,
          but the inner content needs overflow-visible for slider thumbs to render properly */}
      <div
        className={cn(
          "transition-all duration-200 ease-in-out",
          isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"
        )}
      >
        <div className="pt-1.5 pb-0.5 space-y-1.5">
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * SectionDivider Component
 * A subtle horizontal rule for separating sections
 */
export function SectionDivider({ className }: { className?: string }) {
  return (
    <hr className={cn('border-t border-border my-4', className)} />
  );
}
