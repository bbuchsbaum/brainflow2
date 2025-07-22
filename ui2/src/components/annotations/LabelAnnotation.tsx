import React, { useMemo } from 'react';
import type { Label } from '@/types/annotations';
import type { ScreenCoordinates } from '@/types/coordinates';
import { useAnnotationStore } from '@/stores/annotationStore';

interface LabelAnnotationProps {
  annotation: Label;
  screenPos: ScreenCoordinates;
}

export const LabelAnnotation: React.FC<LabelAnnotationProps> = ({
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

  // Calculate text anchor position based on anchor setting
  function getTextAnchor(anchor: string): string {
    switch (anchor) {
      case 'left': return 'start';
      case 'right': return 'end';
      case 'center':
      default:
        return 'middle';
    }
  }

  function getAnchorOffset(anchor: string): [number, number] {
    const offset = 20; // Distance from point
    
    switch (anchor) {
      case 'top': return [0, -offset];
      case 'bottom': return [0, offset];
      case 'left': return [-offset, 0];
      case 'right': return [offset, 0];
      case 'center':
      default:
        return [0, -offset]; // Default to top
    }
  }

  const textAnchor = useMemo(() => getTextAnchor(annotation.anchor), [annotation.anchor]);
  const [offsetX, offsetY] = useMemo(() => getAnchorOffset(annotation.anchor), [annotation.anchor]);
  const textX = screenPos[0] + offsetX;
  const textY = screenPos[1] + offsetY;
  const fontSize = annotation.style?.fontSize || 12;
  const strokeWidth = isSelected ? 2 : isHovered ? 1.5 : 1;

  return (
    <g 
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      className="cursor-pointer transition-all duration-100 ease-in-out"
    >
      {/* Connection line from point to text */}
      <line
        x1={screenPos[0]}
        y1={screenPos[1]}
        x2={textX}
        y2={textY}
        stroke={annotation.style?.color || '#FFD93D'}
        strokeWidth={strokeWidth}
        strokeOpacity="0.6"
        strokeDasharray="2,2"
      />

      {/* Anchor point */}
      <circle
        cx={screenPos[0]}
        cy={screenPos[1]}
        r="3"
        fill={annotation.style?.color || '#FFD93D'}
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity={annotation.style?.opacity || 1}
      />

      {/* Text background */}
      <rect
        x={textX - (annotation.text.length * fontSize * 0.3)}
        y={textY - fontSize}
        width={annotation.text.length * fontSize * 0.6}
        height={fontSize + 4}
        rx="2"
        fill="rgba(0, 0, 0, 0.7)"
        stroke={isSelected ? '#007ACC' : isHovered ? '#FFA500' : 'transparent'}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Text */}
      <text
        x={textX}
        y={textY - 2}
        textAnchor={textAnchor}
        fontFamily="Arial, sans-serif"
        fontSize={fontSize}
        fill={annotation.style?.color || '#FFD93D'}
        opacity={annotation.style?.opacity || 1}
        dominantBaseline="middle"
        style={{ 
          pointerEvents: 'none', 
          userSelect: 'none' 
        }}
      >
        {annotation.text}
      </text>

      {/* Selection highlight */}
      {isSelected && (
        <circle
          cx={screenPos[0]}
          cy={screenPos[1]}
          r="8"
          fill="none"
          stroke="#007ACC"
          strokeWidth="2"
          strokeDasharray="4,2"
          opacity="0.8"
        />
      )}

      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <circle
          cx={screenPos[0]}
          cy={screenPos[1]}
          r="6"
          fill="none"
          stroke="#FFA500"
          strokeWidth="1"
          opacity="0.6"
        />
      )}
    </g>
  );
};