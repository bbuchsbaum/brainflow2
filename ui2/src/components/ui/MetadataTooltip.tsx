import React from 'react';
import type { VolumeMetadata } from '@/stores/layerStore';
import {
  formatVolumeDataRange,
  formatVolumeDimensions,
  formatVolumeSpacing,
  formatVolumeVoxelSummary,
} from '@/utils/metadataFormatting';

interface MetadataTooltipProps {
  metadata: VolumeMetadata;
  className?: string;
}

/**
 * MetadataTooltip - Displays essential volume metadata in a compact tooltip format
 * Shows the most important fields with smart formatting
 */
export const MetadataTooltip: React.FC<MetadataTooltipProps> = ({ metadata, className = '' }) => {
  const voxelSummary = formatVolumeVoxelSummary(metadata);

  return (
    <div className={`p-4 ${className}`}>
      <div className="space-y-2">
        {/* Dimensions */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Dimensions</span>
          <span className="font-mono text-sm text-right">{formatVolumeDimensions(metadata)}</span>
        </div>

        {/* Spacing/Resolution */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Resolution</span>
          <span className="font-mono text-sm text-right">{formatVolumeSpacing(metadata)}</span>
        </div>

        {/* Data Range */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Data Range</span>
          <span className="font-mono text-sm text-right">{formatVolumeDataRange(metadata)}</span>
        </div>

        {/* Data Type */}
        {metadata.dataType && (
          <div className="grid grid-cols-2 gap-4">
            <span className="text-muted-foreground text-sm">Type</span>
            <span className="font-mono text-sm text-right">{metadata.dataType}</span>
          </div>
        )}

        {/* Voxel Info */}
        {voxelSummary && (
          <div className="grid grid-cols-2 gap-4">
            <span className="text-muted-foreground text-sm">Size</span>
            <span className="font-mono text-xs text-right">{voxelSummary}</span>
          </div>
        )}

        {/* Binary indicator */}
        {metadata.isBinaryLike && (
          <div className="text-center mt-3 px-2 py-1 bg-yellow-500/10 text-yellow-600 text-xs rounded">
            Binary mask detected
          </div>
        )}
      </div>
    </div>
  );
};

export default MetadataTooltip;
