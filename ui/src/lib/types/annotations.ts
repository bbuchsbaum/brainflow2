/**
 * Core annotation types for neuroimaging views
 * 
 * Annotations can be associated with world coordinates and optionally
 * linked to specific volume layers. They support both 2D rendering
 * on slice views and future 3D rendering.
 */

import type { Vec2, Vec3 } from '../geometry/types';

// Base annotation interface
export interface BaseAnnotation {
  id: string;
  worldCoord: Vec3;
  visible: boolean;
  layerId?: string; // Optional association with volume layer
  createdAt: number; // Timestamp
  modifiedAt: number;
  locked?: boolean; // Prevent editing
  userData?: Record<string, unknown>; // Custom metadata
}

// Text annotation
export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  text: string;
  fontSize?: number; // In pixels
  fontFamily?: string;
  color?: string; // CSS color
  backgroundColor?: string; // Optional background
  anchor?: 'center' | 'left' | 'right' | 'top' | 'bottom';
  offset?: Vec2; // Screen offset from world position in pixels
  maxWidth?: number; // Maximum width before wrapping
}

// Marker annotation
export interface MarkerAnnotation extends BaseAnnotation {
  type: 'marker';
  style: 'cross' | 'circle' | 'square' | 'diamond' | 'plus' | 'x';
  size: number; // In pixels
  color: string; // CSS color
  strokeWidth?: number;
  filled?: boolean;
  fillColor?: string; // If different from stroke color
}

// Line annotation (connects two points)
export interface LineAnnotation extends BaseAnnotation {
  type: 'line';
  endCoord: Vec3;
  color: string;
  strokeWidth?: number;
  dashed?: boolean;
  dashPattern?: number[]; // e.g., [5, 5] for dashed line
  arrowStart?: boolean;
  arrowEnd?: boolean;
  label?: string; // Optional label at midpoint
}

// Region of Interest (ROI) annotation
export interface ROIAnnotation extends BaseAnnotation {
  type: 'roi';
  shape: 'circle' | 'rectangle' | 'ellipse' | 'polygon';
  // Dimensions depend on shape:
  // circle: { radius: number } (in mm)
  // rectangle: { width: number, height: number } (in mm)
  // ellipse: { radiusX: number, radiusY: number } (in mm)
  // polygon: { points: Vec3[] } (world coordinates)
  dimensions: any; // Shape-specific dimensions
  color: string;
  strokeWidth?: number;
  filled?: boolean;
  fillOpacity?: number; // 0-1
  label?: string;
}

// Measurement annotation
export interface MeasurementAnnotation extends BaseAnnotation {
  type: 'measurement';
  measurementType: 'distance' | 'angle' | 'area';
  points: Vec3[]; // 2 for distance, 3 for angle, N for area
  color: string;
  strokeWidth?: number;
  showValue?: boolean;
  unit?: 'mm' | 'cm' | 'voxels';
  precision?: number; // Decimal places
}

// Union type for all annotations
export type Annotation = 
  | TextAnnotation 
  | MarkerAnnotation 
  | LineAnnotation 
  | ROIAnnotation
  | MeasurementAnnotation;

// Annotation groups for organization
export interface AnnotationGroup {
  id: string;
  name: string;
  visible: boolean;
  color?: string; // Default color for annotations in this group
  locked?: boolean;
  annotationIds: string[];
}

// Helper type guards
export const isTextAnnotation = (a: Annotation): a is TextAnnotation => 
  a.type === 'text';

export const isMarkerAnnotation = (a: Annotation): a is MarkerAnnotation => 
  a.type === 'marker';

export const isLineAnnotation = (a: Annotation): a is LineAnnotation => 
  a.type === 'line';

export const isROIAnnotation = (a: Annotation): a is ROIAnnotation => 
  a.type === 'roi';

export const isMeasurementAnnotation = (a: Annotation): a is MeasurementAnnotation => 
  a.type === 'measurement';

// Annotation event types for interaction
export interface AnnotationEvent {
  type: 'hover' | 'click' | 'drag' | 'edit' | 'delete';
  annotation: Annotation;
  screenPos: Vec2;
  worldPos: Vec3;
  originalEvent: MouseEvent | TouchEvent;
}

// Annotation tool modes
export type AnnotationToolMode = 
  | 'select'
  | 'text'
  | 'marker'
  | 'line'
  | 'circle'
  | 'rectangle'
  | 'polygon'
  | 'measure-distance'
  | 'measure-angle'
  | 'measure-area';

// Export format options
export type AnnotationExportFormat = 
  | 'json'
  | 'nifti' // As label volume
  | 'fsl' // FSLeyes format
  | 'itksnap' // ITK-SNAP format
  | 'csv'; // Simple tabular format