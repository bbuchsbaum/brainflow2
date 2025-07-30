import React from 'react';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/shadcn/select';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/utils/cn';

// Export toolbar height for consistent spacing
export const MOSAIC_TOOLBAR_HEIGHT = 40; // px

interface MosaicToolbarProps {
  axis: 'axial' | 'sagittal' | 'coronal';
  onAxisChange: (v: 'axial' | 'sagittal' | 'coronal') => void;
  grid: string;
  onGridChange: (v: string) => void;
  page: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

export function MosaicToolbar({
  axis,
  onAxisChange,
  grid,
  onGridChange,
  page,
  pageCount,
  canPrev,
  canNext,
  onPrev,
  onNext,
  className
}: MosaicToolbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30", // Stays visible, doesn't overlap content
        "flex items-center gap-3",
        "h-10 px-4",
        "glass-panel-light", // Glass-morphism effect
        "border-b border-[var(--app-border-subtle)]", // Theme border
        "shadow-glow-sm", // Enhanced shadow
        className
      )}
      style={{ height: MOSAIC_TOOLBAR_HEIGHT }}
    >
      {/* Axis Selector */}
      <Select value={axis} onValueChange={onAxisChange}>
        <SelectTrigger className="h-8 w-[88px] text-xs input-modern text-[var(--app-text-primary)]">
          <SelectValue>
            {axis.charAt(0).toUpperCase() + axis.slice(1)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="dropdown-menu-modern">
          <SelectItem value="axial" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">Axial</SelectItem>
          <SelectItem value="sagittal" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">Sagittal</SelectItem>
          <SelectItem value="coronal" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">Coronal</SelectItem>
        </SelectContent>
      </Select>

      {/* Grid Selector */}
      <Select value={grid} onValueChange={onGridChange}>
        <SelectTrigger className="h-8 w-[72px] text-xs input-modern text-[var(--app-text-primary)]">
          <SelectValue>{grid}</SelectValue>
        </SelectTrigger>
        <SelectContent className="dropdown-menu-modern">
          <SelectItem value="2x2" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">2×2</SelectItem>
          <SelectItem value="3x3" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">3×3</SelectItem>
          <SelectItem value="4x4" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">4×4</SelectItem>
          <SelectItem value="5x5" className="text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)]">5×5</SelectItem>
        </SelectContent>
      </Select>

      {/* Spacer to push navigation to the right */}
      <div className="flex-1" />

      {/* Navigation Controls */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!canPrev}
          onClick={onPrev}
          className="inline-flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--app-text-secondary)] rounded-[var(--app-radius-sm)] cursor-pointer transition-all duration-[var(--app-transition-fast)] hover:bg-[var(--app-bg-hover)] hover:text-[var(--app-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--app-text-secondary)]"
          aria-label="Previous page"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        
        <span className="w-[64px] text-center text-xs font-medium text-[var(--app-text-primary)] tabular-nums">
          {page + 1} / {pageCount}
        </span>
        
        <button
          type="button"
          disabled={!canNext}
          onClick={onNext}
          className="inline-flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--app-text-secondary)] rounded-[var(--app-radius-sm)] cursor-pointer transition-all duration-[var(--app-transition-fast)] hover:bg-[var(--app-bg-hover)] hover:text-[var(--app-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--app-text-secondary)]"
          aria-label="Next page"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}