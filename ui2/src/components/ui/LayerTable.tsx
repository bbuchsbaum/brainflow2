import React, { useRef, useEffect } from 'react';
import type { Layer } from '@/types/layers';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';
import { Info } from 'lucide-react';
import { MetadataPopover } from './MetadataPopover';
import { cn } from '@/utils/cn';

interface LayerTableProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onShowMetadata?: (layerId: string) => void;
}

export const LayerTable: React.FC<LayerTableProps> = ({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisibility,
  onShowMetadata
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return;
      
      const currentIndex = layers.findIndex(l => l.id === selectedLayerId);
      let newIndex = currentIndex;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          newIndex = Math.min(currentIndex + 1, layers.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          newIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (currentIndex >= 0) {
            onToggleVisibility(layers[currentIndex].id);
          }
          break;
        default:
          return;
      }
      
      if (newIndex !== currentIndex && newIndex >= 0) {
        onSelect(layers[newIndex].id);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layers, selectedLayerId, onSelect, onToggleVisibility]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedLayerId]);
  if (layers.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground text-center py-8">
        No layers loaded
      </div>
    );
  }

  return (
    <div className="w-full">
      <label className="block text-[13px] font-medium mb-3 text-foreground">
        Layers
      </label>
      
      <div 
        ref={containerRef}
        className="space-y-1" 
        role="listbox"
        aria-label="Layer list"
        aria-activedescendant={selectedLayerId || undefined}
      >
        {layers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          return (
            <div
              key={layer.id}
              ref={isSelected ? selectedRef : null}
              role="option"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className={cn(
                "layer-row group",
                isSelected && "selected"
              )}
              onClick={() => onSelect(layer.id)}
            >
              {/* Visibility toggle - flat design */}
              <button
                className={cn(
                  "icon-btn",
                  layer.visible && "active"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                aria-pressed={layer.visible}
                data-state={layer.visible ? "on" : "off"}
                tabIndex={-1}
              >
                {layer.visible ? (
                  <VscEye className="h-4 w-4" />
                ) : (
                  <VscEyeClosed className="h-4 w-4" />
                )}
              </button>

              {/* Layer name */}
              <span 
                className={cn(
                  "flex-1 text-[13px] font-medium truncate",
                  isSelected ? "text-accent" : "text-foreground"
                )}
                title={layer.name}
              >
                {layer.name}
              </span>

              {/* Info button - flat design, only visible on hover */}
              <MetadataPopover layerId={layer.id}>
                <button
                  className="icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    // The popover will handle the click, no need for onShowMetadata
                  }}
                  aria-label={`Metadata for ${layer.name}`}
                  tabIndex={-1}
                >
                  <Info className="h-4 w-4" />
                </button>
              </MetadataPopover>
            </div>
          );
        })}
      </div>
    </div>
  );
};