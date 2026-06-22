import React, { useCallback } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useSceneStack } from "@/hooks/useSceneStack";
import { useInspectorSelectionStore } from "@/stores/inspectorSelectionStore";
import { getLayerService } from "@/services/LayerService";
import type { SceneItem } from "@/types/sceneItem";
import { InspectorSection } from "./InspectorSection";
import { SceneStackItem } from "./SceneStackItem";

/**
 * Scene section of the imaging Inspector. Three subgroups:
 *   - VOLUME VIEW
 *   - SURFACE VIEW   (rendered only when surfaces are loaded)
 *   - MAPPINGS       (rendered only when vol→surf mappings exist)
 *
 * Empty surface and mapping groups are hidden — discoverability moves to
 * the `+ Load` sheet in the Inspector header so the rail isn't permanent
 * empty-state noise. Volume View is always rendered (a Brainflow session
 * is volume-first; if there are zero volumes the user is on a brand-new
 * canvas and the empty placeholder serves as the obvious next-action).
 */
export function SceneStack() {
  const { volumes, surfaces, mappings } = useSceneStack();
  const activeItemId = useInspectorSelectionStore(
    (state) => state.activeItemId,
  );
  const setActive = useInspectorSelectionStore((state) => state.setActive);

  const summary = buildSummary(volumes, surfaces, mappings);

  // Reordering a volume changes its z-order: the layer-array order is the
  // render contract (index 0 = base/bottom). All the store + ViewState + render
  // plumbing already lives behind `layerService.reorderLayers`; the UI just
  // hands it the new id order. Surfaces/mappings are not reorderable here.
  const handleVolumeReorder = useCallback((orderedIds: string[]) => {
    void getLayerService()
      .reorderLayers(orderedIds)
      .catch((error) => {
        console.error("[SceneStack] Failed to reorder volume layers:", error);
      });
  }, []);

  return (
    <InspectorSection
      label="Scene"
      icon={<SceneIcon />}
      defaultOpen
      meta={summary}
    >
      <VolumeSceneGroup
        items={volumes}
        activeItemId={activeItemId}
        onSelect={setActive}
        onReorder={handleVolumeReorder}
      />
      <SceneGroup
        title="Surface View"
        items={surfaces}
        emptyHint="No surfaces loaded"
        showWhenEmpty={false}
        activeItemId={activeItemId}
        onSelect={setActive}
      />
      <SceneGroup
        title="Mappings"
        items={mappings}
        emptyHint="No vol-to-surface mappings yet"
        showWhenEmpty={false}
        activeItemId={activeItemId}
        onSelect={setActive}
      />
    </InspectorSection>
  );
}

function SceneGroup({
  title,
  items,
  emptyHint,
  showWhenEmpty,
  activeItemId,
  onSelect,
}: {
  title: string;
  items: SceneItem[];
  emptyHint: string;
  showWhenEmpty: boolean;
  activeItemId: string | null;
  onSelect: (item: SceneItem) => void;
}) {
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-card/30 px-3 py-2 text-[11px] text-muted-foreground/70">
          {emptyHint}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <SceneStackItem
              key={item.id}
              item={item}
              selected={item.id === activeItemId}
              onSelect={() => onSelect(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Volume View group, with drag-to-reorder (z-order) via dnd-kit. Mirrors
 * `SceneGroup`'s title/empty-state chrome but makes the rows sortable. Always
 * rendered (volume-first session), so the dnd-kit hooks are unconditional.
 * Sortable affordances only appear with 2+ volumes — a single layer has
 * nothing to reorder.
 */
function VolumeSceneGroup({
  items,
  activeItemId,
  onSelect,
  onReorder,
}: {
  items: SceneItem[];
  activeItemId: string | null;
  onSelect: (item: SceneItem) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    // Small activation distance so a click still selects; only a real drag
    // gesture from the grip starts a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        Volume View
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-card/30 px-3 py-2 text-[11px] text-muted-foreground/70">
          No volumes loaded — use + Load
        </div>
      ) : items.length === 1 ? (
        <div className="flex flex-col gap-0.5">
          <SceneStackItem
            item={items[0]}
            selected={items[0].id === activeItemId}
            onSelect={() => onSelect(items[0])}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <SortableSceneStackItem
                  key={item.id}
                  item={item}
                  selected={item.id === activeItemId}
                  onSelect={() => onSelect(item)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/**
 * A `SceneStackItem` wrapped for dnd-kit sortable: the wrapper div is the
 * sortable node, and a grip handle (drag activator) fades in on row hover.
 */
function SortableSceneStackItem({
  item,
  selected,
  onSelect,
}: {
  item: SceneItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    position: "relative",
    // Matches Design.md §23.1 `--bf-z-drag` (DnD-kit drag overlay).
    zIndex: isDragging ? 3000 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };

  const handle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={(event) => event.stopPropagation()}
      aria-label={`Drag to reorder ${item.name}`}
      title="Drag to reorder"
      className="-ml-1 flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <SceneStackItem
        item={item}
        selected={selected}
        onSelect={onSelect}
        dragHandle={handle}
      />
    </div>
  );
}

/**
 * Compact section meta line, e.g. "2 items · volume" or "5 items · mixed".
 * Renders to the right of the SCENE header, before the chevron.
 */
function buildSummary(
  volumes: SceneItem[],
  surfaces: SceneItem[],
  mappings: SceneItem[],
): string | null {
  const total = volumes.length + surfaces.length + mappings.length;
  if (total === 0) return null;

  const kinds: string[] = [];
  if (volumes.length > 0) kinds.push("volume");
  if (surfaces.length > 0) kinds.push("surface");
  if (mappings.length > 0) kinds.push("mapping");
  const kindLabel = kinds.length === 1 ? kinds[0] : "mixed";

  return `${total} item${total === 1 ? "" : "s"} · ${kindLabel}`;
}

function SceneIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="3" rx="0.5" />
      <rect x="2" y="7" width="12" height="3" rx="0.5" />
      <rect x="2" y="11" width="12" height="2.5" rx="0.5" />
    </svg>
  );
}
