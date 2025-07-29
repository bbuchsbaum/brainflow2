import React, { useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger, 
  PopoverArrow 
} from '@/components/ui/shadcn/popover';
import { cn } from '@/utils/cn';
import type { VolumeMetadata } from '@/stores/layerStore';
import { Copy, Check } from 'lucide-react';

interface MetadataPopoverProps {
  layerId: string;
  children: React.ReactNode;
}

export const MetadataPopover: React.FC<MetadataPopoverProps> = ({ 
  layerId, 
  children 
}) => {
  const metadata = useLayerStore(state => state.getLayerMetadata(layerId));
  const layer = useLayerStore(state => state.layers.find(l => l.id === layerId));
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  if (!metadata || !layer) {
    return <>{children}</>;
  }

  // Format dimensions as "X × Y × Z"
  const formatDimensions = () => {
    if (!metadata.dimensions) return 'Unknown';
    return metadata.dimensions.join(' × ');
  };

  // Format spacing with units
  const formatSpacing = () => {
    if (!metadata.spacing) return 'Unknown';
    return metadata.spacing.map(s => `${s.toFixed(2)} mm`).join(' × ');
  };

  // Format data range
  const formatDataRange = () => {
    if (!metadata.dataRange) return 'Unknown';
    return `[${metadata.dataRange.min.toFixed(2)}, ${metadata.dataRange.max.toFixed(2)}]`;
  };

  // Copy to clipboard handler
  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      
      <PopoverContent 
        side="right" 
        align="center"
        className={cn(
          // Layout and spacing
          "!p-8",
          "w-80 max-w-[90vw]",
          // Appearance - with explicit full opacity
          "bg-popover/100 text-popover-foreground/100",
          "rounded-[var(--radius)]",
          "border border-border",
          "shadow-lg",
          // Z-index to ensure visibility
          "z-[100]",
          // Animations
          "data-[state=open]:animate-in",
          "data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0",
          "data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95",
          "data-[state=open]:zoom-in-95",
          "data-[side=right]:slide-in-from-left-2",
          "data-[side=left]:slide-in-from-right-2",
          "data-[side=top]:slide-in-from-bottom-2",
          "data-[side=bottom]:slide-in-from-top-2"
        )}
        style={{
          // Fallback inline styles with hardcoded dark theme colors
          backgroundColor: 'rgba(15, 23, 42, 1)', // #0f172a with full opacity
          color: 'rgba(226, 232, 240, 1)', // #e2e8f0 with full opacity
          padding: '32px', // Force larger padding via inline style
        }}
        sideOffset={16}
        collisionPadding={12}
        avoidCollisions={true}
        aria-label="Metadata information"
        role="dialog"
        aria-describedby="metadata-content"
      >
        <PopoverArrow className="fill-popover" />
        
        {/* Inner wrapper for additional padding */}
        <div className="p-4">
          {/* Header Section */}
          <div className="mb-4 pb-4 border-b border-border/50">
            <h3 className="text-sm font-semibold text-popover-foreground mb-1">
              {layer?.name || 'Unknown Layer'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Layer Metadata
            </p>
          </div>
            
          {/* Metadata Content */}
          <div className="space-y-4" id="metadata-content">
            {/* Dimensions Section */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Volume Properties
              </h4>
              <div className="space-y-1.5">
                {/* Dimensions */}
                <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                  <span className="text-xs text-muted-foreground">Dimensions</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-popover-foreground tabular-nums">
                      {formatDimensions()}
                    </span>
                    <button
                      onClick={() => copyToClipboard(formatDimensions(), 'dimensions')}
                      className="ml-2 p-1 rounded hover:bg-accent/30 transition-colors"
                      aria-label="Copy dimensions"
                    >
                      {copiedField === 'dimensions' ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-popover-foreground" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Resolution */}
                <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                  <span className="text-xs text-muted-foreground">Resolution</span>
                  <span className="text-sm font-medium text-popover-foreground tabular-nums">
                    {formatSpacing()}
                  </span>
                </div>

                {/* Data Range */}
                <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                  <span className="text-xs text-muted-foreground">Data Range</span>
                  <span className="text-sm font-medium font-mono text-popover-foreground">
                    {formatDataRange()}
                  </span>
                </div>

                {/* Data Type */}
                {metadata.dataType && (
                  <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <span className="text-sm font-medium font-mono text-popover-foreground">
                      {metadata.dataType}
                    </span>
                  </div>
                )}

                {/* Voxel info */}
                {metadata.totalVoxels && (
                  <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                    <span className="text-xs text-muted-foreground">Voxels</span>
                    <div className="text-sm font-medium text-popover-foreground">
                      <span className="tabular-nums">
                        {(metadata.totalVoxels / 1_000_000).toFixed(1)}M
                      </span>
                      {metadata.nonZeroVoxels && (
                        <span className="text-muted-foreground text-xs ml-1">
                          ({((metadata.nonZeroVoxels / metadata.totalVoxels) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Binary indicator badge */}
          {metadata.isBinaryLike && (
            <div className="mt-4 mx-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-xs rounded-md text-center font-medium">
              Binary mask detected
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};