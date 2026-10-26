/**
 * OrthogonalViewContainer - Container for all three orthogonal slice views
 * Manages layout with Axial on top, Sagittal and Coronal on bottom
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { IconButton } from '@/components/ui/bf';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { ResizableOrthoGrid } from './ResizableOrthoGrid';
import { useViewLayoutStore } from '@/stores/viewLayoutStore';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { readFileDragData, getActiveDragData, clearActiveDragData } from '@/utils/layerDrag';
import { resolveDropOpenIntent } from '@/types/loadIntent';

interface OrthogonalViewContainerProps {
  className?: string;
  containerWidth?: number;
  containerHeight?: number;
}

export function OrthogonalViewContainer({
  className = '',
  containerWidth,
  containerHeight,
}: OrthogonalViewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // View layout state
  const { mode, toggleMode, isLocked } = useViewLayoutStore();

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + L to toggle layout mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        toggleMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode]);

  // Log Golden Layout dimensions (FlexibleSlicePanel will handle its own sizing)
  useEffect(() => {
    if (containerWidth && containerHeight) {
      console.log(
        `[OrthogonalViewContainer] Golden Layout dimensions received: ${containerWidth}x${containerHeight} - FlexibleSlicePanel components will handle individual sizing`,
      );
    }
  }, [containerWidth, containerHeight]);

  // Native event listeners for drag-and-drop.
  // We use native listeners (not React synthetic) because GoldenLayout's
  // isolated React roots can interfere with React event delegation.
  // Tauri's native drag interception is disabled via dragDropEnabled:false
  // in tauri.conf.json so HTML5 drag events flow normally.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    };

    const onDragLeave = (e: DragEvent) => {
      const rect = el.getBoundingClientRect();
      if (
        e.clientX <= rect.left ||
        e.clientX >= rect.right ||
        e.clientY <= rect.top ||
        e.clientY >= rect.bottom
      ) {
        setIsDragging(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const fileLoadingService = getFileLoadingService();
      const intent = resolveDropOpenIntent({
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      });

      // 1. Native OS file drops (from Finder)
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) {
        const validExtensions = ['.nii', '.nii.gz', '.gii'];
        for (const file of files) {
          if (validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
            void fileLoadingService.loadDroppedFile(file, intent);
          }
        }
        clearActiveDragData();
        return;
      }

      // 2. Cross-panel bridge (in-app drags across GoldenLayout panels)
      const bridgeData = getActiveDragData();
      if (bridgeData?.path) {
        void fileLoadingService.loadFile(bridgeData.path, 'drag-drop', intent);
        clearActiveDragData();
        return;
      }

      // 3. Fallback: dataTransfer (same React root)
      if (e.dataTransfer) {
        const draggedFile = readFileDragData(e.dataTransfer);
        if (draggedFile?.path) {
          void fileLoadingService.loadFile(draggedFile.path, 'drag-drop', intent);
        }
      }
      clearActiveDragData();
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);

    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`orthogonal-view-container ${className} h-full w-full relative bg-background`}
    >
      {/* Toggle button - minimal design */}
      <IconButton
        variant="secondary"
        size="sm"
        className="absolute top-3 right-3 z-20 bg-card/60"
        icon={isLocked() ? <Lock /> : <Unlock />}
        onClick={toggleMode}
        aria-label={isLocked() ? 'Unlock views' : 'Lock views together'}
        title={isLocked() ? 'Unlock views for flexible layout (⌘L)' : 'Lock views together (⌘L)'}
      />

      {/* Layout: Axial on top, Sagittal | Coronal below — with draggable
          resize gutters (ResizableOrthoGrid). */}
      <div className="h-full w-full p-1">
        <ResizableOrthoGrid
          arrangement="grid"
          axial={<FlexibleSlicePanel viewId="axial" title="Axial" />}
          sagittal={<FlexibleSlicePanel viewId="sagittal" title="Sagittal" />}
          coronal={<FlexibleSlicePanel viewId="coronal" title="Coronal" />}
        />
      </div>

      {/* Container-level drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 pointer-events-none flex items-center justify-center z-50">
          <div className="rounded-sm border border-border bg-popover px-6 py-4 shadow-2xl">
            <div className="text-primary font-semibold text-bf-lg">
              Drop neuroimaging files to load
            </div>
            <div className="text-muted-foreground text-bf-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        </div>
      )}
    </div>
  );
}
