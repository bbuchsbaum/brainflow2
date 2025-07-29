import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Annotation } from '@/types/annotations';
import type { ViewPlane } from '@/types/coordinates';
import { useCoordinateTransform } from '@/utils/coordinateTransform';
import { sortAnnotationsByZOrder } from '@/stores/annotationStore';

import { MarkerAnnotation } from '../annotations/MarkerAnnotation';
import { ROIAnnotation } from '../annotations/ROIAnnotation';
import { LabelAnnotation } from '../annotations/LabelAnnotation';
import { MeasurementAnnotation } from '../annotations/MeasurementAnnotation';

interface AnnotationOverlayProps {
  plane: ViewPlane;
  annotations: Annotation[];
  children?: React.ReactNode;
  onDeleteSelected?: () => void;
  onClearSelection?: () => void;
}

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
  plane,
  annotations,
  children,
  onDeleteSelected,
  onClearSelection
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const transform = useCoordinateTransform();

  // Efficiently filter and project annotations
  const visibleAnnotations = useMemo(() => {
    return sortAnnotationsByZOrder(
      annotations
        .filter(ann => ann.visible)
        .map(ann => {
          const screenPos = transform.worldToScreen(ann.world_mm, plane);
          return screenPos ? {
            ...ann,
            screenPos
          } : null;
        })
        .filter(ann => ann !== null)
    );
  }, [annotations, transform, plane]);

  // Handle view resize
  const handleResize = React.useCallback(() => {
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      setContainerSize({
        width: rect.width,
        height: rect.height
      });
    }
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = React.useCallback((event: KeyboardEvent) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDeleteSelected?.();
    }
  }, [onDeleteSelected]);

  // Background click to clear selection
  const handleBackgroundClick = React.useCallback((event: React.MouseEvent) => {
    if (event.target === svgRef.current) {
      onClearSelection?.();
    }
  }, [onClearSelection]);

  // Setup resize observer and keyboard listener
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(svgElement);

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleResize, handleKeyDown]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none w-full h-full"
      viewBox={`0 0 ${plane.dim_px[0]} ${plane.dim_px[1]}`}
      preserveAspectRatio="none"
      onClick={handleBackgroundClick}
      style={{
        shapeRendering: 'geometricPrecision',
        textRendering: 'optimizeLegibility'
      }}
    >
      {/* Enable pointer events for annotations */}
      <g className="pointer-events-auto">
        {visibleAnnotations.map((annotation) => {
          switch (annotation.type) {
            case 'marker':
              return (
                <MarkerAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  screenPos={annotation.screenPos}
                />
              );
            case 'roi':
              return (
                <ROIAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  screenPos={annotation.screenPos}
                  plane={plane}
                />
              );
            case 'label':
              return (
                <LabelAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  screenPos={annotation.screenPos}
                />
              );
            case 'measurement':
              return (
                <MeasurementAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  screenPos={annotation.screenPos}
                  plane={plane}
                />
              );
            default:
              return null;
          }
        })}
      </g>

      {/* Crosshair or other overlays can be added here */}
      {children}
      
      <style>{`
        /* Optimize for performance with many annotations */
        .annotation-overlay {
          contain: layout style paint;
          will-change: transform;
        }

        /* Ensure proper layering */
        .annotation-overlay .annotation-marker {
          z-index: 100;
        }

        .annotation-overlay .annotation-roi {
          z-index: 90;
        }

        .annotation-overlay .annotation-measurement {
          z-index: 95;
        }

        .annotation-overlay .annotation-label {
          z-index: 110;
        }

        .annotation-overlay .annotation-selected {
          z-index: 200;
        }
      `}</style>
    </svg>
  );
};