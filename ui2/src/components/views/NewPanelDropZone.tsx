/**
 * NewPanelDropZone
 *
 * A dashed placeholder at the end of the comparison grid.
 * Dropping a layer here creates a new comparison panel containing that layer.
 */

import { useState, useCallback } from 'react';
import { readFileDragData, readLayerDragData } from '@/utils/layerDrag';

interface NewPanelDropZoneProps {
  onDrop: (layerId: string) => void;
  onFileDrop?: (path: string) => void | Promise<void>;
  onNativeFileDrop?: (file: File) => void | Promise<void>;
}

export function NewPanelDropZone({ onDrop, onFileDrop, onNativeFileDrop }: NewPanelDropZoneProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void onNativeFileDrop?.(files[0]);
      return;
    }

    const data = readLayerDragData(e.dataTransfer);
    if (data?.layerId) {
      onDrop(data.layerId);
      return;
    }

    const fileData = readFileDragData(e.dataTransfer);
    if (fileData?.path) {
      void onFileDrop?.(fileData.path);
    }
  }, [onDrop, onFileDrop, onNativeFileDrop]);

  return (
    <div
      className={`flex min-h-[120px] items-center justify-center rounded-appsm border-2 border-dashed transition-colors ${
        isOver
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="text-xs select-none pointer-events-none">
        + Drop layer or file to add panel
      </span>
    </div>
  );
}
