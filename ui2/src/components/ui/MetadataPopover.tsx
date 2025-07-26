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
          "max-w-[18rem]",                 // flexible width
          "rounded-lg",                    // softer corners
          "border border-gray-700/40",     // lighter border
          "bg-gray-900 text-gray-100",     // solid background
          "shadow-xl shadow-black/20",     // refined shadow
          // Enter animations
          "animate-in fade-in-0 zoom-in-95",
          "data-[state=open]:animate-in",
          "data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0",
          "data-[state=closed]:zoom-out-95",
          "duration-200"                   // smooth transitions
        )}
        style={{ backgroundColor: 'rgba(17, 24, 39, 0.95)' }}
        sideOffset={8}
        aria-label="Metadata information"
        role="dialog"
        aria-describedby="metadata-content"
      >
        <PopoverArrow className="fill-gray-900" />
        
        {/* Inner wrapper div with padding - avoids Radix's all:unset */}
        <div className="p-6">
          {/* Header */}
          <h3 className="text-sm font-semibold text-gray-100 mb-4">
            Layer Metadata
          </h3>
          
          {/* Definition list for semantic pairing */}
          <dl id="metadata-content" className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="font-normal text-gray-400">Dimensions</dt>
          <dd className="text-right font-medium text-gray-100 tabular-nums group/item relative">
            <button
              onClick={() => copyToClipboard(formatDimensions(), 'dimensions')}
              className="inline-flex items-center gap-1 hover:text-gray-50 transition-colors"
              aria-label="Copy dimensions to clipboard"
            >
              {formatDimensions()}
              <span className="opacity-0 group-hover/item:opacity-100 transition-opacity">
                {copiedField === 'dimensions' ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </span>
            </button>
          </dd>

          <dt className="font-normal text-gray-400">Resolution</dt>
          <dd className="text-right font-medium text-gray-100 tabular-nums">
            {formatSpacing()}
          </dd>

          <dt className="font-normal text-gray-400">Data Range</dt>
          <dd className="text-right font-medium font-mono text-gray-100 text-xs">
            {formatDataRange()}
          </dd>

          {metadata.dataType && (
            <>
              <dt className="font-normal text-gray-400">Type</dt>
              <dd className="text-right font-medium font-mono text-gray-100 text-xs">
                {metadata.dataType}
              </dd>
            </>
          )}

          {/* Voxel info */}
          {metadata.totalVoxels && (
            <>
              <dt className="font-normal text-gray-400">Voxels</dt>
              <dd className="text-right font-medium text-gray-100">
                <span className="tabular-nums">
                  {(metadata.totalVoxels / 1_000_000).toFixed(1)}M
                </span>
                {metadata.nonZeroVoxels && (
                  <span className="text-gray-500 text-xs ml-1">
                    ({((metadata.nonZeroVoxels / metadata.totalVoxels) * 100).toFixed(1)}%)
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>

          {/* Binary indicator badge */}
          {metadata.isBinaryLike && (
            <div className="mt-4 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-xs rounded-md text-center font-medium">
              Binary mask detected
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};