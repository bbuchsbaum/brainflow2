import React, { useMemo } from 'react';
import type { ROI } from '@/types/annotations';
import type { ScreenCoordinates, ViewPlane } from '@/types/coordinates';
import { useAnnotationStore } from '@/stores/annotationStore';
import { worldToScreen } from '@/utils/coordinateTransform';

interface ROIAnnotationProps {
  annotation: ROI;
  screenPos: ScreenCoordinates;
  plane: ViewPlane;
}

export const ROIAnnotation: React.FC<ROIAnnotationProps> = ({
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

  // ROI geometry rendering
  function renderSphere(params: number[]): string {
    const radius = params[0] || 10;
    
    // For sphere, we render as a circle on the slice plane
    // The radius in screen coordinates depends on the plane scaling
    const screenRadius = radius / Math.sqrt(
      plane.u_mm[0] ** 2 + plane.u_mm[1] ** 2 + plane.u_mm[2] ** 2
    );
    
    return `M ${screenPos[0] - screenRadius} ${screenPos[1]} A ${screenRadius} ${screenRadius} 0 1 1 ${screenPos[0] + screenRadius} ${screenPos[1]} A ${screenRadius} ${screenRadius} 0 1 1 ${screenPos[0] - screenRadius} ${screenPos[1]}`;
  }

  function renderBox(params: number[]): string {
    const [width = 20, height = 20, depth = 20] = params;
    
    // For box, render as a rectangle on the slice plane
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    
    // Convert to screen coordinates
    const screenHalfWidth = halfWidth / Math.sqrt(
      plane.u_mm[0] ** 2 + plane.u_mm[1] ** 2 + plane.u_mm[2] ** 2
    );
    const screenHalfHeight = halfHeight / Math.sqrt(
      plane.v_mm[0] ** 2 + plane.v_mm[1] ** 2 + plane.v_mm[2] ** 2
    );
    
    const left = screenPos[0] - screenHalfWidth;
    const right = screenPos[0] + screenHalfWidth;
    const top = screenPos[1] - screenHalfHeight;
    const bottom = screenPos[1] + screenHalfHeight;
    
    return `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
  }

  function renderPolygon(params: number[]): string {
    // Params should be [x1, y1, z1, x2, y2, z2, ...]
    const points = [];
    
    for (let i = 0; i < params.length; i += 3) {
      const worldPoint: [number, number, number] = [
        annotation.world_mm[0] + params[i],
        annotation.world_mm[1] + params[i + 1],
        annotation.world_mm[2] + params[i + 2]
      ];
      
      const screenPoint = worldToScreen(worldPoint, plane);
      if (screenPoint) {
        points.push(screenPoint);
      }
    }
    
    if (points.length < 3) {
      return ''; // Need at least 3 points for a polygon
    }
    
    let path = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i][0]} ${points[i][1]}`;
    }
    path += ' Z';
    
    return path;
  }

  const roiPath = useMemo(() => {
    switch (annotation.geometry.type) {
      case 'sphere':
        return renderSphere(annotation.geometry.params);
      case 'box':
        return renderBox(annotation.geometry.params);
      case 'polygon':
        return renderPolygon(annotation.geometry.params);
      default:
        return renderSphere([10]); // Fallback
    }
  }, [annotation.geometry, screenPos, plane]);

  const strokeWidth = isSelected ? 3 : isHovered ? 2 : 1;
  const fillOpacity = isSelected ? 0.2 : isHovered ? 0.15 : 0.1;

  return (
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
          d={roiPath}
          fill="none"
          stroke="#007ACC"
          strokeWidth="3"
          strokeDasharray="6,3"
          opacity="0.8"
          transform="scale(1.1)"
          style={{ transformOrigin: `${screenPos[0]}px ${screenPos[1]}px` }}
        />
      )}

      {/* Main ROI */}
      <path
        d={roiPath}
        fill={annotation.style?.color || '#4ECDC4'}
        fillOpacity={fillOpacity}
        stroke={annotation.style?.color || '#4ECDC4'}
        strokeWidth={strokeWidth}
        strokeOpacity={annotation.style?.opacity || 1}
      />

      {/* Center point */}
      <circle
        cx={screenPos[0]}
        cy={screenPos[1]}
        r="2"
        fill={annotation.style?.color || '#4ECDC4'}
        opacity="0.8"
      />

      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <path
          d={roiPath}
          fill="none"
          stroke="#FFA500"
          strokeWidth="2"
          opacity="0.6"
        />
      )}
    </g>
  );
};