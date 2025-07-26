/**
 * useMetadataShortcut - Keyboard shortcut for showing metadata drawer
 * Cmd/Ctrl + I opens metadata for the selected layer
 */

import { useEffect } from 'react';
import { useLayerStore } from '@/stores/layerStore';

interface UseMetadataShortcutProps {
  onShowMetadata: (layerId: string) => void;
}

export function useMetadataShortcut({ onShowMetadata }: UseMetadataShortcutProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Check for Cmd/Ctrl + I
      const isMetaKey = e.metaKey || e.ctrlKey;
      if (isMetaKey && e.key === 'i') {
        e.preventDefault();
        
        // Get selected layer
        const selectedLayerId = useLayerStore.getState().selectedLayerId;
        if (selectedLayerId) {
          onShowMetadata(selectedLayerId);
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onShowMetadata]);
}