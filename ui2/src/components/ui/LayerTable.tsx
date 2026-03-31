import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Layer } from '@/types/layers';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';
import { GripVertical, Info, MoreHorizontal, Trash2 } from 'lucide-react';
import { LayerTypeIcon } from './LayerTypeIcon';
import { cn } from '@/utils/cn';
import { Tooltip } from './Tooltip';
import { DropdownMenu } from './DropdownMenu';
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

type LayerWithMeta = Layer & {
  source?: string;
  layerType?: 'volume' | 'surface' | 'vol2surf';
  opacity?: number;
  loading?: boolean;
  error?: string;
};

function toLabelCase(value: string): string {
  if (!value) return value;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getLayerKindLabel(layer: LayerWithMeta): string {
  if (layer.layerType) {
    return toLabelCase(layer.layerType);
  }
  return toLabelCase(layer.type ?? 'layer');
}

function getSourceLabel(layer: LayerWithMeta): string | null {
  if (!layer.source) return null;
  return toLabelCase(layer.source);
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
        "min-w-0 flex-1 truncate text-[13px] font-medium",
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
  layer: LayerWithMeta;
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
  const layerKindLabel = getLayerKindLabel(layer);
  const sourceLabel = getSourceLabel(layer);
  return (
    <div
      ref={setNodeRef}
      id={`layer-option-${layer.id}`}
      style={style}
      role="option"
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      className={cn(
        "layer-row group min-w-0 overflow-hidden border-l-[3px]",
        isSelected
          ? "border-l-accent bg-muted/40"
          : "border-l-transparent hover:border-l-border",
        !isVisible && "opacity-70"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="icon-btn cursor-grab active:cursor-grabbing touch-none shrink-0"
        aria-label="Drag to reorder"
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
      >
        {isVisible ? (
          <VscEye className="h-4 w-4" />
        ) : (
          <VscEyeClosed className="h-4 w-4" />
        )}
      </button>

      {/* Layer type icon */}
      {layer.layerType && (
        <div className="px-0.5 shrink-0">
          <LayerTypeIcon
            type={layer.layerType}
            className={isSelected ? "text-accent" : "text-muted-foreground"}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Row 1: name + action buttons */}
        <div className="flex min-w-0 items-center gap-1">
          <LayerNameWithTooltip name={layer.name} isSelected={isSelected} />
          {layer.loading && (
            <span className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Loading
            </span>
          )}
          {layer.error && (
            <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-destructive">
              Error
            </span>
          )}
          <div className="flex shrink-0 items-center ml-auto" onClick={(e) => e.stopPropagation()}>
            {onRemove && (
              <button
                className={cn(
                  "icon-btn",
                  "rounded-md transition-colors",
                  "hover:bg-destructive/20 active:bg-destructive/30"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                aria-label={`Remove ${layer.name}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            )}
            <DropdownMenu
              position="bottom-right"
              trigger={
                <button
                  type="button"
                  className="icon-btn rounded-md"
                  aria-label={`Layer actions for ${layer.name}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
              items={[
                {
                  id: 'metadata',
                  label: 'View metadata',
                  icon: <Info className="h-3.5 w-3.5" />,
                  onClick: onShowMetadata,
                },
                {
                  id: 'remove',
                  label: 'Remove layer',
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  danger: true,
                  disabled: !onRemove,
                  onClick: onRemove,
                },
              ]}
            />
          </div>
        </div>
        {/* Row 2: metadata badge + opacity percentage */}
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="shrink-0 rounded border border-border px-1 py-px uppercase tracking-[0.08em]">
            {layerKindLabel}
          </span>
          {sourceLabel && (
            <span className="truncate">Source: {sourceLabel}</span>
          )}
          <span className="ml-auto shrink-0 tabular-nums">{Math.round(opacity * 100)}%</span>
        </div>
      </div>
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

  const handleListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT') return;

    const currentIndex = layers.findIndex((layer) => layer.id === selectedLayerId);
    let newIndex = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        // Prevent horizontal scrolling of parent containers while layer list is focused.
        event.preventDefault();
        return;
      case 'ArrowDown':
        event.preventDefault();
        newIndex = Math.min(currentIndex + 1, layers.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        newIndex = Math.max(currentIndex - 1, 0);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
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
  }, [layers, selectedLayerId, onSelect, onToggleVisibility]);

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
            aria-activedescendant={selectedLayerId ? `layer-option-${selectedLayerId}` : undefined}
            onKeyDown={handleListKeyDown}
          >
            {layers.map((layer) => {
              const layerWithMeta = layer as LayerWithMeta;
              const isSelected = layer.id === selectedLayerId;
              const isVisible = getLayerVisibility
                ? getLayerVisibility(layer.id)
                : layer.visible;
              const opacity = getLayerOpacity
                ? getLayerOpacity(layer.id)
                : layerWithMeta.opacity ?? 1.0;

              return (
                <SortableLayerRow
                  key={layer.id}
                  layer={layerWithMeta}
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
