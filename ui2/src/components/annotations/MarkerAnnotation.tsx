import React from 'react';
import type { Marker } from '@/types/annotations';
import type { ScreenCoordinates } from '@/types/coordinates';
import { useAnnotationStore } from '@/stores/annotationStore';

interface MarkerAnnotationProps {
  annotation: Marker;
  screenPos: ScreenCoordinates;
}

export const MarkerAnnotation: React.FC<MarkerAnnotationProps> = ({
  annotation,
  screenPos
}) => {
  const annotationStore = useAnnotationStore();
  const isSelected = annotation.selected;
  const isHovered = useAnnotationStore(state => state.hoveredId === annotation.id);

  function handleClick(event: React.MouseEvent) {
    event.stopPropagation();
    annotationStore.toggleSelection(annotation.id);
  }

  function handleMouseEnter() {
    annotationStore.setHovered(annotation.id);
  }

  function handleMouseLeave() {
    annotationStore.setHovered(null);
  }

  // Symbol path generators
  function getSymbolPath(symbol: string, size: number): string {
    const halfSize = size / 2;
    
    switch (symbol) {
      case 'circle':
        return `M ${-halfSize} 0 A ${halfSize} ${halfSize} 0 1 1 ${halfSize} 0 A ${halfSize} ${halfSize} 0 1 1 ${-halfSize} 0`;
      
      case 'square':
        return `M ${-halfSize} ${-halfSize} L ${halfSize} ${-halfSize} L ${halfSize} ${halfSize} L ${-halfSize} ${halfSize} Z`;
      
      case 'diamond':
        return `M 0 ${-halfSize} L ${halfSize} 0 L 0 ${halfSize} L ${-halfSize} 0 Z`;
      
      case 'cross':
        const thickness = size / 6;
        const half = halfSize;
        const t = thickness / 2;
        return `M ${-t} ${-half} L ${t} ${-half} L ${t} ${-t} L ${half} ${-t} L ${half} ${t} L ${t} ${t} L ${t} ${half} L ${-t} ${half} L ${-t} ${t} L ${-half} ${t} L ${-half} ${-t} L ${-t} ${-t} Z`;
      
      default:
        return getSymbolPath('circle', size);
    }
  }

  const symbolPath = getSymbolPath(annotation.symbol, annotation.size);
  const strokeWidth = isSelected ? 3 : isHovered ? 2 : 1;
  const fillOpacity = isSelected ? 0.3 : isHovered ? 0.2 : 0.1;

  return (
    <g 
      transform={`translate(${screenPos[0]}, ${screenPos[1]})`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      className="cursor-pointer transition-all duration-100 ease-in-out"
    >
      {/* Selection highlight */}
      {isSelected && (
        <circle
          r={annotation.size / 2 + 4}
          fill="none"
          stroke="#007ACC"
          strokeWidth="2"
          strokeDasharray="4,2"
          opacity="0.8"
        />
      )}

      {/* Main marker */}
      <path
        d={symbolPath}
        fill={annotation.style?.color || '#FF6B6B'}
        fillOpacity={fillOpacity}
        stroke={annotation.style?.color || '#FF6B6B'}
        strokeWidth={strokeWidth}
        strokeOpacity={annotation.style?.opacity || 1}
      />

      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <circle
          r={annotation.size / 2 + 2}
          fill="none"
          stroke="#FFA500"
          strokeWidth="1"
          opacity="0.6"
        />
      )}
    </g>
  );
};