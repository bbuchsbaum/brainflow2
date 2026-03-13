import React, { useEffect, useRef, useState } from 'react';
import { useLayer, layerSelectors } from '@/stores/layerStore';
import { Popover, PopoverContent, PopoverTrigger, PopoverArrow } from '@/components/ui/shadcn/popover';
import { cn } from '@/utils/cn';
import { Copy, Check } from 'lucide-react';
import {
  formatVolumeDataRange,
  formatVolumeDimensions,
  formatVolumeSpacing,
  formatVolumeVoxelSummary,
} from '@/utils/metadataFormatting';

interface MetadataPopoverProps {
  layerId: string;
  children: React.ReactNode;
}

export const MetadataPopover: React.FC<MetadataPopoverProps> = ({ 
  layerId, 
  children 
}) => {
  const metadata = useLayer((state) => layerSelectors.getLayerMetadata(state, layerId));
  const layer = useLayer((state) => layerSelectors.getLayerById(state, layerId));
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);
  
  if (!metadata || !layer) {
    return <>{children}</>;
  }

  const dimensionsText = formatVolumeDimensions(metadata);
  const spacingText = formatVolumeSpacing(metadata);
  const dataRangeText = formatVolumeDataRange(metadata);
  const voxelSummary = formatVolumeVoxelSummary(metadata);

  // Copy to clipboard handler
  const copyToClipboard = async (text: string, field: string) => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopiedField(null);
        resetTimerRef.current = null;
      }, 2000);
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
          'z-[100] w-80 max-w-[90vw] p-0'
        )}
        sideOffset={12}
        collisionPadding={12}
        avoidCollisions={true}
        aria-label="Metadata information"
        aria-describedby="metadata-content"
      >
        <PopoverArrow className="fill-popover" />
        
        <div className="p-4">
          {/* Header Section */}
          <div className="mb-4 pb-4 border-b border-border/50">
            <h3 className="text-sm font-semibold text-popover-foreground mb-1">
              {layer.name}
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
                      {dimensionsText}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(dimensionsText, 'dimensions')}
                      className="ml-2 p-1 rounded hover:bg-accent/30 transition-colors"
                      aria-label={copiedField === 'dimensions' ? 'Dimensions copied' : 'Copy dimensions'}
                      data-copied={copiedField === 'dimensions'}
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
                    {spacingText}
                  </span>
                </div>

                {/* Data Range */}
                <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                  <span className="text-xs text-muted-foreground">Data Range</span>
                  <span className="text-sm font-medium font-mono text-popover-foreground">
                    {dataRangeText}
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
                {voxelSummary && (
                  <div className="flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors">
                    <span className="text-xs text-muted-foreground">Voxels</span>
                    <span className="text-sm font-medium text-popover-foreground tabular-nums">
                      {voxelSummary}
                    </span>
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
