import React from 'react';
import type { VolumeMetadata } from '@/stores/layerStore';

interface MetadataTooltipProps {
  metadata: VolumeMetadata;
  className?: string;
}

/**
 * MetadataTooltip - Displays essential volume metadata in a compact tooltip format
 * Shows the most important fields with smart formatting
 */
export const MetadataTooltip: React.FC<MetadataTooltipProps> = ({ metadata, className = '' }) => {
  // Format dimensions as "X x Y x Z"
  const formatDimensions = () => {
    if (!metadata.dimensions) return 'Unknown';
    return metadata.dimensions.join(' × ');
  };

  // Format spacing with units
  const formatSpacing = () => {
    if (!metadata.spacing) return 'Unknown';
    return metadata.spacing.map(s => s.toFixed(2)).join(' × ') + ' mm';
  };

  // Format data range
  const formatDataRange = () => {
    if (!metadata.dataRange) return 'Unknown';
    return `[${metadata.dataRange.min.toFixed(2)}, ${metadata.dataRange.max.toFixed(2)}]`;
  };

  // Format file size if we have voxel count
  const formatVoxelInfo = () => {
    if (!metadata.totalVoxels) return null;
    const millions = (metadata.totalVoxels / 1_000_000).toFixed(1);
    
    if (metadata.nonZeroVoxels) {
      const percentage = ((metadata.nonZeroVoxels / metadata.totalVoxels) * 100).toFixed(1);
      return `${millions}M voxels (${percentage}% non-zero)`;
    }
    
    return `${millions}M voxels`;
  };

  return (
    <div className={`p-4 ${className}`}>
      <div className="space-y-2">
        {/* Dimensions */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Dimensions</span>
          <span className="font-mono text-sm text-right">{formatDimensions()}</span>
        </div>

        {/* Spacing/Resolution */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Resolution</span>
          <span className="font-mono text-sm text-right">{formatSpacing()}</span>
        </div>

        {/* Data Range */}
        <div className="grid grid-cols-2 gap-4">
          <span className="text-muted-foreground text-sm">Data Range</span>
          <span className="font-mono text-sm text-right">{formatDataRange()}</span>
        </div>

        {/* Data Type */}
        {metadata.dataType && (
          <div className="grid grid-cols-2 gap-4">
            <span className="text-muted-foreground text-sm">Type</span>
            <span className="font-mono text-sm text-right">{metadata.dataType}</span>
          </div>
        )}

        {/* Voxel Info */}
        {formatVoxelInfo() && (
          <div className="grid grid-cols-2 gap-4">
            <span className="text-muted-foreground text-sm">Size</span>
            <span className="font-mono text-xs text-right">{formatVoxelInfo()}</span>
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