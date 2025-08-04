import React, { useRef, useEffect, useState } from 'react';
import type { Layer } from '@/types/layers';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';
import { Info } from 'lucide-react';
import { MetadataPopover } from './MetadataPopover';
import { cn } from '@/utils/cn';
import { Tooltip } from './Tooltip';

interface LayerTableProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onShowMetadata?: (layerId: string) => void;
  // Function to get visibility state from opacity (single source of truth)
  getLayerVisibility?: (layerId: string) => boolean;
}

// Component to handle layer name with tooltip on truncation
const LayerNameWithTooltip: React.FC<{ name: string; isSelected: boolean }> = ({ name, isSelected }) => {
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const checkTruncation = () => {
      if (textRef.current) {
        setIsTruncated(textRef.current.scrollWidth > textRef.current.clientWidth);
      }
    };

    checkTruncation();
    // Check again on window resize
    window.addEventListener('resize', checkTruncation);
    return () => window.removeEventListener('resize', checkTruncation);
  }, [name]);

  const content = (
    <span 
      ref={textRef}
      className={cn(
        "flex-1 text-[13px] font-medium truncate",
        isSelected ? "text-accent" : "text-foreground"
      )}
    >
      {name}
    </span>
  );

  if (isTruncated) {
    return (
      <Tooltip content={name} position="top" delay={300}>
        {content}
      </Tooltip>
    );
  }

  return content;
};

export const LayerTable: React.FC<LayerTableProps> = ({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisibility,
  onShowMetadata,
  getLayerVisibility
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
      <div 
        ref={containerRef}
        className="space-y-1" 
        role="listbox"
        aria-label="Layer list"
        aria-activedescendant={selectedLayerId || undefined}
      >
        {layers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          // SINGLE SOURCE OF TRUTH: Use derived visibility from opacity
          const isVisible = getLayerVisibility ? getLayerVisibility(layer.id) : layer.visible;
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
                  isVisible && "active"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                aria-label={isVisible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                aria-pressed={isVisible}
                data-state={isVisible ? "on" : "off"}
                tabIndex={-1}
              >
                {isVisible ? (
                  <VscEye className="h-4 w-4" />
                ) : (
                  <VscEyeClosed className="h-4 w-4" />
                )}
              </button>

              {/* Layer name with smart tooltip */}
              <LayerNameWithTooltip
                name={layer.name}
                isSelected={isSelected}
              />

              {/* Info button - modern design with improved hover states */}
              <MetadataPopover layerId={layer.id}>
                <button
                  className={cn(
                    "icon-btn",
                    "opacity-0 group-hover:opacity-100 focus:opacity-100",
                    "transition-all duration-200",
                    "hover:bg-accent/20 active:bg-accent/30",
                    "rounded-md p-1"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  aria-label={`View metadata for ${layer.name}`}
                  tabIndex={-1}
                >
                  <Info className="h-4 w-4 text-muted-foreground" />
                </button>
              </MetadataPopover>
            </div>
          );
        })}
      </div>
    </div>
  );
};