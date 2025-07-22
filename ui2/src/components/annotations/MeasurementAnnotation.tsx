import React, { useMemo } from 'react';
import type { Measurement } from '@/types/annotations';
import type { ScreenCoordinates, ViewPlane } from '@/types/coordinates';
import { useAnnotationStore } from '@/stores/annotationStore';
import { worldToScreen } from '@/utils/coordinateTransform';

interface MeasurementAnnotationProps {
  annotation: Measurement;
  screenPos: ScreenCoordinates;
  plane: ViewPlane;
}

export const MeasurementAnnotation: React.FC<MeasurementAnnotationProps> = ({
  annotation,
  screenPos,
  plane
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

  // Convert measurement points to screen coordinates
  const screenPoints = useMemo(() => {
    return annotation.points
      .map(point => worldToScreen(point, plane))
      .filter(point => point !== null) as ScreenCoordinates[];
  }, [annotation.points, plane]);

  // Generate path for measurement line(s)
  const measurementPath = useMemo(() => {
    if (screenPoints.length < 2) return '';
    
    let path = `M ${screenPoints[0][0]} ${screenPoints[0][1]}`;
    for (let i = 1; i < screenPoints.length; i++) {
      path += ` L ${screenPoints[i][0]} ${screenPoints[i][1]}`;
    }
    return path;
  }, [screenPoints]);

  // Calculate midpoint for value display
  const midpoint = useMemo(() => {
    if (screenPoints.length < 2) return screenPos;
    
    const totalX = screenPoints.reduce((sum, point) => sum + point[0], 0);
    const totalY = screenPoints.reduce((sum, point) => sum + point[1], 0);
    
    return [
      totalX / screenPoints.length,
      totalY / screenPoints.length
    ] as ScreenCoordinates;
  }, [screenPoints, screenPos]);

  const strokeWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
  const valueText = `${annotation.value.toFixed(2)} ${annotation.unit}`;
  const markerColor = annotation.style?.color || '#FF9500';

  return (
    <>
      {/* Arrow markers for measurement lines */}
      <defs>
        <marker
          id={`measurement-start-${annotation.id}`}
          markerWidth="8"
          markerHeight="8"
          refX="1"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0,0 0,6 6,3"
            fill={markerColor}
          />
        </marker>
        
        <marker
          id={`measurement-end-${annotation.id}`}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0,3 6,0 6,6"
            fill={markerColor}
          />
        </marker>
      </defs>

      <g 
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-all duration-100 ease-in-out"
      >
        {/* Selection highlight */}
        {isSelected && (
          <path
            d={measurementPath}
            fill="none"
            stroke="#007ACC"
            strokeWidth="5"
            strokeDasharray="6,3"
            opacity="0.4"
          />
        )}

        {/* Main measurement line */}
        <path
          d={measurementPath}
          fill="none"
          stroke={annotation.style?.color || '#FF9500'}
          strokeWidth={strokeWidth}
          strokeOpacity={annotation.style?.opacity || 1}
          markerStart={`url(#measurement-start-${annotation.id})`}
          markerEnd={`url(#measurement-end-${annotation.id})`}
        />

        {/* Measurement points */}
        {screenPoints.map((point, index) => (
          <g key={index}>
            <circle
              cx={point[0]}
              cy={point[1]}
              r={isSelected ? 4 : 3}
              fill={annotation.style?.color || '#FF9500'}
              stroke="#FFFFFF"
              strokeWidth="1"
              opacity={annotation.style?.opacity || 1}
            />
            
            {/* Point labels */}
            <text
              x={point[0]}
              y={point[1] - 8}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontSize="10"
              fill={annotation.style?.color || '#FF9500'}
              opacity="0.8"
              style={{ 
                pointerEvents: 'none', 
                userSelect: 'none' 
              }}
            >
              {index + 1}
            </text>
          </g>
        ))}

        {/* Value display */}
        <g transform={`translate(${midpoint[0]}, ${midpoint[1] - 15})`}>
          {/* Background */}
          <rect
            x={-valueText.length * 3}
            y="-8"
            width={valueText.length * 6}
            height="16"
            rx="3"
            fill="rgba(0, 0, 0, 0.8)"
            stroke={isSelected ? '#007ACC' : isHovered ? '#FFA500' : 'transparent'}
            strokeWidth={isSelected ? 2 : 1}
          />
          
          {/* Value text */}
          <text
            x="0"
            y="0"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontSize="12"
            fontWeight="bold"
            fill={annotation.style?.color || '#FF9500'}
            dominantBaseline="central"
            style={{ 
              pointerEvents: 'none', 
              userSelect: 'none' 
            }}
          >
            {valueText}
          </text>
        </g>

        {/* Hover highlight */}
        {isHovered && !isSelected && (
          <path
            d={measurementPath}
            fill="none"
            stroke="#FFA500"
            strokeWidth="3"
            opacity="0.6"
          />
        )}
      </g>
    </>
  );
};