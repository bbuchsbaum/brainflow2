/**
 * Annotation types for neuroimaging visualization
 */

export interface AnnotationStyle {
  color: string;
  opacity: number;
  strokeWidth?: number;
  fontSize?: number;
}

export interface BaseAnnotation {
  id: string;
  type: 'marker' | 'roi' | 'measurement' | 'label';
  world_mm: [number, number, number];
  visible: boolean;
  selected: boolean;
  group?: string;
  style?: AnnotationStyle;
  metadata?: Record<string, any>;
}

export interface Marker extends BaseAnnotation {
  type: 'marker';
  symbol: 'circle' | 'cross' | 'square' | 'diamond';
  size: number;
}

export interface ROI extends BaseAnnotation {
  type: 'roi';
  geometry: {
    type: 'sphere' | 'box' | 'polygon';
    params: number[]; // Depends on type
  };
}

export interface Measurement extends BaseAnnotation {
  type: 'measurement';
  points: Array<[number, number, number]>; // World coordinates
  value: number;
  unit: string;
}

export interface Label extends BaseAnnotation {
  type: 'label';
  text: string;
  anchor: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export type Annotation = Marker | ROI | Measurement | Label;