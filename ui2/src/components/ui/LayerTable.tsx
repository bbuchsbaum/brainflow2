import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Layer } from '@/types/layers';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';
import { GripVertical, Info, Trash2 } from 'lucide-react';
import { MetadataPopover } from './MetadataPopover';
import { LayerTypeIcon } from './LayerTypeIcon';
import { cn } from '@/utils/cn';
import { Tooltip } from './Tooltip';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

interface LayerTableProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onShowMetadata?: (layerId: string) => void;
  onReorder?: (newLayers: Layer[]) => void;
  onOpacityChange?: (layerId: string, opacity: number) => void;
  onRemove?: (layerId: string) => void;
  // Function to get visibility state from opacity (single source of truth)
  getLayerVisibility?: (layerId: string) => boolean;
  getLayerOpacity?: (layerId: string) => number;
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

// Individual sortable layer row
interface SortableLayerRowProps {
  layer: Layer;
  isSelected: boolean;
  isVisible: boolean;
  opacity: number;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onOpacityChange: (opacity: number) => void;
  onShowMetadata?: () => void;
  onRemove?: () => void;
}

const SortableLayerRow: React.FC<SortableLayerRowProps> = ({
  layer,
  isSelected,
  isVisible,
  opacity,
  onSelect,
  onToggleVisibility,
  onOpacityChange,
  onShowMetadata,
  onRemove,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="option"
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      className={cn("layer-row group", isSelected && "selected")}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="icon-btn cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground" />
      </button>

      {/* Visibility toggle */}
      <button
        className={cn("icon-btn", isVisible && "active")}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility();
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

      {/* Layer type icon */}
      {'layerType' in layer && (
        <div className="px-1">
          <LayerTypeIcon
            type={(layer as any).layerType}
            className={isSelected ? "text-accent" : "text-muted-foreground"}
          />
        </div>
      )}

      {/* Layer name */}
      <LayerNameWithTooltip name={layer.name} isSelected={isSelected} />

      {/* Opacity mini-slider */}
      <div
        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
        title={`Opacity: ${Math.round(opacity * 100)}%`}
      >
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          className="w-[52px] h-1 accent-accent cursor-pointer"
          tabIndex={-1}
          aria-label={`Opacity for ${layer.name}`}
        />
      </div>

      {/* Info button */}
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
            onShowMetadata?.();
          }}
          aria-label={`View metadata for ${layer.name}`}
          tabIndex={-1}
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </button>
      </MetadataPopover>

      {onRemove && (
        <button
          className={cn(
            "icon-btn",
            "opacity-0 group-hover:opacity-100 focus:opacity-100",
            "transition-all duration-200",
            "hover:bg-destructive/20 active:bg-destructive/30",
            "rounded-md p-1"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${layer.name}`}
          tabIndex={-1}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
};

export const LayerTable: React.FC<LayerTableProps> = ({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisibility,
  onShowMetadata,
  onReorder,
  onOpacityChange,
  onRemove,
  getLayerVisibility,
  getLayerOpacity,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = layers.findIndex(l => l.id === active.id);
    const newIndex = layers.findIndex(l => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(layers, oldIndex, newIndex);
    onReorder?.(reordered);
  }, [layers, onReorder]);

  // Handle keyboard navigation within the list
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
    // VolumeLayerPanel renders a dedicated empty-state component.
    return null;
  }

  const layerIds = layers.map(l => l.id);

  return (
    <div className="w-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={layerIds} strategy={verticalListSortingStrategy}>
          <div
            ref={containerRef}
            className="space-y-1"
            role="listbox"
            aria-label="Layer list"
            aria-activedescendant={selectedLayerId || undefined}
          >
            {layers.map((layer) => {
              const isSelected = layer.id === selectedLayerId;
              const isVisible = getLayerVisibility
                ? getLayerVisibility(layer.id)
                : layer.visible;
              const opacity = getLayerOpacity
                ? getLayerOpacity(layer.id)
                : (layer as any).opacity ?? 1.0;

              return (
                <SortableLayerRow
                  key={layer.id}
                  layer={layer}
                  isSelected={isSelected}
                  isVisible={isVisible}
                  opacity={opacity}
                  onSelect={() => onSelect(layer.id)}
                  onToggleVisibility={() => onToggleVisibility(layer.id)}
                  onOpacityChange={(newOpacity) => onOpacityChange?.(layer.id, newOpacity)}
                  onShowMetadata={onShowMetadata ? () => onShowMetadata(layer.id) : undefined}
                  onRemove={onRemove ? () => onRemove(layer.id) : undefined}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};
