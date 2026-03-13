import { useCallback } from 'react';
import { readFileDragData, readLayerDragData } from '@/utils/layerDrag';

interface UseViewportDropTargetArgs {
  onLayerDrop?: (layerId: string) => void;
  onPathDrop?: (path: string) => void | Promise<void>;
  onNativeFileDrop?: (file: File) => void | Promise<void>;
}

export function useViewportDropTarget({
  onLayerDrop,
  onPathDrop,
  onNativeFileDrop,
}: UseViewportDropTargetArgs) {
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void onNativeFileDrop?.(files[0]);
      return;
    }

    const layerData = readLayerDragData(event.dataTransfer);
    if (layerData?.layerId && onLayerDrop) {
      onLayerDrop(layerData.layerId);
      return;
    }

    const fileData = readFileDragData(event.dataTransfer);
    if (fileData?.path) {
      void onPathDrop?.(fileData.path);
    }
  }, [onLayerDrop, onNativeFileDrop, onPathDrop]);

  return {
    handleDragOver,
    handleDrop,
  };
}
