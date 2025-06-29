/**
 * AnnotationRenderer - Handles canvas rendering of annotations
 * 
 * This class is responsible for drawing annotations on a 2D canvas overlay.
 * It supports different annotation types (text, markers, lines, ROIs, measurements)
 * and handles coordinate transformation from world space to screen space.
 */

import type { 
  Annotation, 
  TextAnnotation, 
  MarkerAnnotation, 
  LineAnnotation, 
  ROIAnnotation,
  MeasurementAnnotation 
} from '$lib/types/annotations';
import type { ViewFrameExplicit, Vec2, Vec3 } from '$lib/geometry/types';
import { worldToScreen } from '$lib/geometry/viewFrameExplicit';

export interface AnnotationStyle {
  defaultColor: string;
  selectedColor: string;
  hoveredColor: string;
  defaultStrokeWidth: number;
  selectedStrokeWidth: number;
  defaultFontSize: number;
  fontFamily: string;
  shadowColor: string;
  shadowBlur: number;
}

export class AnnotationRenderer {
  private style: AnnotationStyle;
  
  constructor(style?: Partial<AnnotationStyle>) {
    this.style = {
      defaultColor: '#00ff00',
      selectedColor: '#ffff00',
      hoveredColor: '#ff00ff',
      defaultStrokeWidth: 2,
      selectedStrokeWidth: 3,
      defaultFontSize: 14,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      shadowColor: 'rgba(0, 0, 0, 0.5)',
      shadowBlur: 3,
      ...style
    };
  }
  
  /**
   * Render all visible annotations
   */
  render(
    ctx: CanvasRenderingContext2D,
    annotations: Annotation[],
    frame: ViewFrameExplicit,
    selectedIds: Set<string> = new Set(),
    hoveredId: string | null = null
  ): void {
    // Save context state
    ctx.save();
    
    // Enable shadow for better visibility
    ctx.shadowColor = this.style.shadowColor;
    ctx.shadowBlur = this.style.shadowBlur;
    
    // Sort annotations: selected/hovered ones on top
    const sortedAnnotations = [...annotations].sort((a, b) => {
      const aSpecial = selectedIds.has(a.id) || a.id === hoveredId;
      const bSpecial = selectedIds.has(b.id) || b.id === hoveredId;
      return aSpecial === bSpecial ? 0 : aSpecial ? 1 : -1;
    });
    
    // Render each annotation
    for (const annotation of sortedAnnotations) {
      if (!annotation.visible) continue;
      
      const isSelected = selectedIds.has(annotation.id);
      const isHovered = annotation.id === hoveredId;
      
      try {
        this.renderAnnotation(ctx, annotation, frame, isSelected, isHovered);
      } catch (error) {
        console.error(`Failed to render annotation ${annotation.id}:`, error);
      }
    }
    
    // Restore context state
    ctx.restore();
  }
  
  /**
   * Render a single annotation
   */
  private renderAnnotation(
    ctx: CanvasRenderingContext2D,
    annotation: Annotation,
    frame: ViewFrameExplicit,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    // Get screen position
    const screenPos = worldToScreen(frame, annotation.worldCoord);
    if (!screenPos) return; // Outside view
    
    // Determine color and style
    const color = this.getAnnotationColor(annotation, isSelected, isHovered);
    const strokeWidth = isSelected ? this.style.selectedStrokeWidth : this.style.defaultStrokeWidth;
    
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = strokeWidth;
    
    // Render based on type
    switch (annotation.type) {
      case 'text':
        this.renderText(ctx, annotation as TextAnnotation, screenPos);
        break;
      case 'marker':
        this.renderMarker(ctx, annotation as MarkerAnnotation, screenPos);
        break;
      case 'line':
        this.renderLine(ctx, annotation as LineAnnotation, frame);
        break;
      case 'roi':
        this.renderROI(ctx, annotation as ROIAnnotation, frame);
        break;
      case 'measurement':
        this.renderMeasurement(ctx, annotation as MeasurementAnnotation, frame);
        break;
    }
    
    // Draw selection indicator
    if (isSelected || isHovered) {
      this.drawSelectionIndicator(ctx, screenPos, isHovered);
    }
  }
  
  /**
   * Render text annotation
   */
  private renderText(ctx: CanvasRenderingContext2D, annotation: TextAnnotation, screenPos: Vec2): void {
    const fontSize = annotation.fontSize || this.style.defaultFontSize;
    const fontFamily = annotation.fontFamily || this.style.fontFamily;
    ctx.font = `${fontSize}px ${fontFamily}`;
    
    // Apply offset
    const x = screenPos.x + (annotation.offset?.x || 0);
    const y = screenPos.y + (annotation.offset?.y || 0);
    
    // Set text alignment
    ctx.textAlign = (annotation.anchor || 'center') as CanvasTextAlign;
    ctx.textBaseline = 'middle';
    
    // Draw background if specified
    if (annotation.backgroundColor) {
      const metrics = ctx.measureText(annotation.text);
      const padding = 4;
      const bgX = x - (annotation.anchor === 'right' ? metrics.width : annotation.anchor === 'center' ? metrics.width / 2 : 0);
      
      ctx.fillStyle = annotation.backgroundColor;
      ctx.fillRect(
        bgX - padding,
        y - fontSize / 2 - padding,
        metrics.width + padding * 2,
        fontSize + padding * 2
      );
      ctx.fillStyle = annotation.color || this.style.defaultColor;
    }
    
    // Handle text wrapping if maxWidth is specified
    if (annotation.maxWidth) {
      this.wrapText(ctx, annotation.text, x, y, annotation.maxWidth, fontSize * 1.2);
    } else {
      ctx.fillText(annotation.text, x, y);
    }
  }
  
  /**
   * Render marker annotation
   */
  private renderMarker(ctx: CanvasRenderingContext2D, annotation: MarkerAnnotation, screenPos: Vec2): void {
    const size = annotation.size;
    const halfSize = size / 2;
    
    ctx.lineWidth = annotation.strokeWidth || this.style.defaultStrokeWidth;
    
    switch (annotation.style) {
      case 'cross':
        ctx.beginPath();
        ctx.moveTo(screenPos.x - halfSize, screenPos.y);
        ctx.lineTo(screenPos.x + halfSize, screenPos.y);
        ctx.moveTo(screenPos.x, screenPos.y - halfSize);
        ctx.lineTo(screenPos.x, screenPos.y + halfSize);
        ctx.stroke();
        break;
        
      case 'plus':
        ctx.beginPath();
        ctx.moveTo(screenPos.x - halfSize, screenPos.y);
        ctx.lineTo(screenPos.x + halfSize, screenPos.y);
        ctx.moveTo(screenPos.x, screenPos.y - halfSize);
        ctx.lineTo(screenPos.x, screenPos.y + halfSize);
        ctx.stroke();
        break;
        
      case 'x':
        ctx.beginPath();
        ctx.moveTo(screenPos.x - halfSize, screenPos.y - halfSize);
        ctx.lineTo(screenPos.x + halfSize, screenPos.y + halfSize);
        ctx.moveTo(screenPos.x - halfSize, screenPos.y + halfSize);
        ctx.lineTo(screenPos.x + halfSize, screenPos.y - halfSize);
        ctx.stroke();
        break;
        
      case 'circle':
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, halfSize, 0, Math.PI * 2);
        if (annotation.filled) {
          ctx.fillStyle = annotation.fillColor || annotation.color;
          ctx.fill();
        }
        ctx.stroke();
        break;
        
      case 'square':
        if (annotation.filled) {
          ctx.fillStyle = annotation.fillColor || annotation.color;
          ctx.fillRect(screenPos.x - halfSize, screenPos.y - halfSize, size, size);
        }
        ctx.strokeRect(screenPos.x - halfSize, screenPos.y - halfSize, size, size);
        break;
        
      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y - halfSize);
        ctx.lineTo(screenPos.x + halfSize, screenPos.y);
        ctx.lineTo(screenPos.x, screenPos.y + halfSize);
        ctx.lineTo(screenPos.x - halfSize, screenPos.y);
        ctx.closePath();
        if (annotation.filled) {
          ctx.fillStyle = annotation.fillColor || annotation.color;
          ctx.fill();
        }
        ctx.stroke();
        break;
    }
  }
  
  /**
   * Render line annotation
   */
  private renderLine(ctx: CanvasRenderingContext2D, annotation: LineAnnotation, frame: ViewFrameExplicit): void {
    const startScreen = worldToScreen(frame, annotation.worldCoord);
    const endScreen = worldToScreen(frame, annotation.endCoord);
    
    if (!startScreen || !endScreen) return;
    
    ctx.lineWidth = annotation.strokeWidth || this.style.defaultStrokeWidth;
    
    // Set dash pattern
    if (annotation.dashed) {
      ctx.setLineDash(annotation.dashPattern || [5, 5]);
    }
    
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endScreen.x, endScreen.y);
    ctx.stroke();
    
    // Reset dash
    ctx.setLineDash([]);
    
    // Draw arrows if specified
    if (annotation.arrowStart) {
      this.drawArrow(ctx, endScreen, startScreen, 10);
    }
    if (annotation.arrowEnd) {
      this.drawArrow(ctx, startScreen, endScreen, 10);
    }
    
    // Draw label if specified
    if (annotation.label) {
      const midX = (startScreen.x + endScreen.x) / 2;
      const midY = (startScreen.y + endScreen.y) / 2;
      
      ctx.font = `${this.style.defaultFontSize}px ${this.style.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Background for better readability
      const metrics = ctx.measureText(annotation.label);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(
        midX - metrics.width / 2 - 4,
        midY - this.style.defaultFontSize / 2 - 2,
        metrics.width + 8,
        this.style.defaultFontSize + 4
      );
      
      ctx.fillStyle = annotation.color;
      ctx.fillText(annotation.label, midX, midY);
    }
  }
  
  /**
   * Render ROI annotation
   */
  private renderROI(ctx: CanvasRenderingContext2D, annotation: ROIAnnotation, frame: ViewFrameExplicit): void {
    const screenPos = worldToScreen(frame, annotation.worldCoord);
    if (!screenPos) return;
    
    ctx.lineWidth = annotation.strokeWidth || this.style.defaultStrokeWidth;
    
    switch (annotation.shape) {
      case 'circle': {
        const radiusPx = annotation.dimensions.radius * frame.pixels_per_mm;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, radiusPx, 0, Math.PI * 2);
        break;
      }
      
      case 'rectangle': {
        const widthPx = annotation.dimensions.width * frame.pixels_per_mm;
        const heightPx = annotation.dimensions.height * frame.pixels_per_mm;
        ctx.beginPath();
        ctx.rect(
          screenPos.x - widthPx / 2,
          screenPos.y - heightPx / 2,
          widthPx,
          heightPx
        );
        break;
      }
      
      case 'ellipse': {
        const radiusXPx = annotation.dimensions.radiusX * frame.pixels_per_mm;
        const radiusYPx = annotation.dimensions.radiusY * frame.pixels_per_mm;
        ctx.beginPath();
        ctx.ellipse(screenPos.x, screenPos.y, radiusXPx, radiusYPx, 0, 0, Math.PI * 2);
        break;
      }
      
      case 'polygon': {
        const points = annotation.dimensions.points as Vec3[];
        if (points.length < 3) return;
        
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const point = worldToScreen(frame, points[i]);
          if (!point) continue;
          
          if (i === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.closePath();
        break;
      }
    }
    
    // Fill if specified
    if (annotation.filled) {
      ctx.globalAlpha = annotation.fillOpacity || 0.3;
      ctx.fillStyle = annotation.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    ctx.stroke();
    
    // Draw label if specified
    if (annotation.label) {
      ctx.font = `${this.style.defaultFontSize}px ${this.style.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = annotation.color;
      ctx.fillText(annotation.label, screenPos.x, screenPos.y - 5);
    }
  }
  
  /**
   * Render measurement annotation
   */
  private renderMeasurement(ctx: CanvasRenderingContext2D, annotation: MeasurementAnnotation, frame: ViewFrameExplicit): void {
    const screenPoints = annotation.points
      .map(p => worldToScreen(frame, p))
      .filter((p): p is Vec2 => p !== null);
    
    if (screenPoints.length !== annotation.points.length) return;
    
    ctx.lineWidth = annotation.strokeWidth || this.style.defaultStrokeWidth;
    
    switch (annotation.measurementType) {
      case 'distance': {
        if (screenPoints.length !== 2) return;
        
        // Draw line
        ctx.beginPath();
        ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
        ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
        ctx.stroke();
        
        // Draw endpoints
        this.drawEndpoint(ctx, screenPoints[0]);
        this.drawEndpoint(ctx, screenPoints[1]);
        
        // Calculate and display distance
        if (annotation.showValue !== false) {
          const dist = this.calculateDistance3D(annotation.points[0], annotation.points[1]);
          const unit = annotation.unit || 'mm';
          const value = this.convertUnit(dist, 'mm', unit);
          const text = `${value.toFixed(annotation.precision || 1)} ${unit}`;
          
          const midX = (screenPoints[0].x + screenPoints[1].x) / 2;
          const midY = (screenPoints[0].y + screenPoints[1].y) / 2;
          
          this.drawMeasurementLabel(ctx, text, midX, midY, annotation.color);
        }
        break;
      }
      
      case 'angle': {
        if (screenPoints.length !== 3) return;
        
        // Draw lines
        ctx.beginPath();
        ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
        ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
        ctx.lineTo(screenPoints[2].x, screenPoints[2].y);
        ctx.stroke();
        
        // Draw endpoints
        screenPoints.forEach(p => this.drawEndpoint(ctx, p));
        
        // Calculate and display angle
        if (annotation.showValue !== false) {
          const angle = this.calculateAngle3D(
            annotation.points[0],
            annotation.points[1],
            annotation.points[2]
          );
          const text = `${angle.toFixed(annotation.precision || 1)}°`;
          
          this.drawMeasurementLabel(
            ctx,
            text,
            screenPoints[1].x,
            screenPoints[1].y - 20,
            annotation.color
          );
        }
        break;
      }
      
      case 'area': {
        if (screenPoints.length < 3) return;
        
        // Draw polygon
        ctx.beginPath();
        ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
        for (let i = 1; i < screenPoints.length; i++) {
          ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        
        // Fill with low opacity
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = annotation.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        
        // Draw vertices
        screenPoints.forEach(p => this.drawEndpoint(ctx, p));
        
        // Calculate and display area
        if (annotation.showValue !== false && screenPoints.length >= 3) {
          // Simplified 2D area calculation for now
          const area = this.calculatePolygonArea(screenPoints) / (frame.pixels_per_mm * frame.pixels_per_mm);
          const unit = annotation.unit === 'cm' ? 'cm²' : 'mm²';
          const value = this.convertArea(area, 'mm²', unit);
          const text = `${value.toFixed(annotation.precision || 1)} ${unit}`;
          
          // Find centroid
          const centroid = this.calculateCentroid(screenPoints);
          this.drawMeasurementLabel(ctx, text, centroid.x, centroid.y, annotation.color);
        }
        break;
      }
    }
  }
  
  // Helper methods
  
  private getAnnotationColor(annotation: Annotation, isSelected: boolean, isHovered: boolean): string {
    if (isHovered) return this.style.hoveredColor;
    if (isSelected) return this.style.selectedColor;
    return annotation.color || this.style.defaultColor;
  }
  
  private drawSelectionIndicator(ctx: CanvasRenderingContext2D, pos: Vec2, isHovered: boolean): void {
    const size = 8;
    ctx.strokeStyle = isHovered ? this.style.hoveredColor : this.style.selectedColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(pos.x - size / 2, pos.y - size / 2, size, size);
  }
  
  private drawArrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, size: number): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - size * Math.cos(angle - Math.PI / 6),
      to.y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - size * Math.cos(angle + Math.PI / 6),
      to.y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }
  
  private drawEndpoint(ctx: CanvasRenderingContext2D, pos: Vec2): void {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  private drawMeasurementLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    ctx.font = `bold ${this.style.defaultFontSize}px ${this.style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Background
    const metrics = ctx.measureText(text);
    const padding = 4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(
      x - metrics.width / 2 - padding,
      y - this.style.defaultFontSize / 2 - padding,
      metrics.width + padding * 2,
      this.style.defaultFontSize + padding * 2
    );
    
    // Text
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  
  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    
    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line.length > 0) {
        ctx.fillText(line, x, currentY);
        line = word + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    
    ctx.fillText(line, x, currentY);
  }
  
  private calculateDistance3D(p1: Vec3, p2: Vec3): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  
  private calculateAngle3D(p1: Vec3, vertex: Vec3, p2: Vec3): number {
    const v1 = {
      x: p1.x - vertex.x,
      y: p1.y - vertex.y,
      z: p1.z - vertex.z
    };
    
    const v2 = {
      x: p2.x - vertex.x,
      y: p2.y - vertex.y,
      z: p2.z - vertex.z
    };
    
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    
    const cosAngle = dot / (mag1 * mag2);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
  }
  
  private calculatePolygonArea(points: Vec2[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }
  
  private calculateCentroid(points: Vec2[]): Vec2 {
    let x = 0, y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
  }
  
  private convertUnit(value: number, from: string, to: string): number {
    if (from === to) return value;
    
    // mm to cm
    if (from === 'mm' && to === 'cm') return value / 10;
    if (from === 'cm' && to === 'mm') return value * 10;
    
    return value;
  }
  
  private convertArea(value: number, from: string, to: string): number {
    if (from === to) return value;
    
    // mm² to cm²
    if (from === 'mm²' && to === 'cm²') return value / 100;
    if (from === 'cm²' && to === 'mm²') return value * 100;
    
    return value;
  }
}