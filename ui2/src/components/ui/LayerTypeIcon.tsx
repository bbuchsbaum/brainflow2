import React from 'react';
import { Box, Hexagon, Link2 } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { cn } from '@/utils/cn';

interface LayerTypeIconProps {
  type: 'volume' | 'surface' | 'vol2surf';
  className?: string;
  size?: number;
}

/**
 * LayerTypeIcon - Displays an icon indicating the layer type
 * 
 * Part of the Facade Pattern implementation to visually distinguish
 * between different layer types in the unified layer list.
 */
export const LayerTypeIcon: React.FC<LayerTypeIconProps> = ({ 
  type, 
  className,
  size = 14 
}) => {
  const iconProps = {
    size,
    className: cn('text-muted-foreground', className)
  };
  
  const getIcon = () => {
    switch (type) {
      case 'volume':
        return <Box {...iconProps} />;
      case 'surface':
        return <Hexagon {...iconProps} />;
      case 'vol2surf':
        return <Link2 {...iconProps} />;
      default:
        return null;
    }
  };
  
  const getTooltipText = () => {
    switch (type) {
      case 'volume':
        return 'Volume Layer (3D/4D imaging data)';
      case 'surface':
        return 'Surface Layer (mesh geometry)';
      case 'vol2surf':
        return 'Volume-to-Surface Mapping';
      default:
        return '';
    }
  };
  
  const icon = getIcon();
  
  if (!icon) return null;
  
  return (
    <Tooltip content={getTooltipText()} position="top" delay={500}>
      <div className="inline-flex items-center justify-center">
        {icon}
      </div>
    </Tooltip>
  );
};