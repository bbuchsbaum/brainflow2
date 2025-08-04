/**
 * CrosshairPreview
 * 
 * Live preview component for crosshair settings.
 * Shows how crosshairs will appear with current settings.
 */

import React, { useEffect, useRef } from 'react';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';

interface CrosshairPreviewProps {
  settings: CrosshairSettings;
}

export function CrosshairPreview({ settings }: CrosshairPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark background with subtle checkerboard pattern
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw subtle checkerboard pattern
    const checkSize = 20;
    ctx.fillStyle = '#222222';
    for (let y = 0; y < canvas.height; y += checkSize) {
      for (let x = 0; x < canvas.width; x += checkSize) {
        if ((x / checkSize + y / checkSize) % 2 === 0) {
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }
    }

    // Draw a simple brain-like shape for context
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, 80, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!settings.visible) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Helper function to set line style
    const setLineStyle = (style: 'solid' | 'dashed' | 'dotted') => {
      switch (style) {
        case 'dashed':
          ctx.setLineDash([8, 4]);
          break;
        case 'dotted':
          ctx.setLineDash([2, 2]);
          break;
        default:
          ctx.setLineDash([]);
      }
    };

    // Draw mirror crosshairs first (so they appear behind)
    if (settings.showMirror) {
      ctx.strokeStyle = settings.mirrorColor;
      ctx.globalAlpha = settings.mirrorOpacity;
      ctx.lineWidth = settings.mirrorThickness;
      setLineStyle(settings.mirrorStyle);

      // Horizontal mirror line
      ctx.beginPath();
      ctx.moveTo(0, centerY - 40);
      ctx.lineTo(canvas.width, centerY - 40);
      ctx.stroke();

      // Vertical mirror line
      ctx.beginPath();
      ctx.moveTo(centerX + 50, 0);
      ctx.lineTo(centerX + 50, canvas.height);
      ctx.stroke();
    }

    // Draw active crosshair
    ctx.globalAlpha = 1;
    ctx.strokeStyle = settings.activeColor;
    ctx.lineWidth = settings.activeThickness;
    setLineStyle(settings.activeStyle);

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();

    // Draw coordinates if enabled
    if (settings.showCoordinates) {
      ctx.setLineDash([]);
      ctx.font = '12px monospace';
      ctx.fillStyle = settings.activeColor;
      ctx.globalAlpha = 0.8;

      let coordText = '';
      switch (settings.coordinateFormat) {
        case 'mm':
          coordText = '(12.5, -45.3, 28.1) mm';
          break;
        case 'voxel':
          coordText = '[128, 96, 112]';
          break;
        case 'both':
          coordText = '(12.5, -45.3, 28.1) mm [128, 96, 112]';
          break;
      }

      // Draw text background
      const textWidth = ctx.measureText(coordText).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(centerX + 5, centerY + 5, textWidth + 10, 20);

      // Draw text
      ctx.fillStyle = settings.activeColor;
      ctx.fillText(coordText, centerX + 10, centerY + 20);
    }

    // Draw center point
    ctx.globalAlpha = 1;
    ctx.fillStyle = settings.activeColor;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();

  }, [settings]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={300}
      className="w-full h-full"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}