import { useCompareEditTarget } from "@/utils/compareDisplay";
import React, { useCallback, useId } from "react";
import { Copy, GripVertical } from "lucide-react";
import { copyValuesAtCrosshair } from "@/services/readoutCopy";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { dropTargetInList } from "./sceneDrop";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useSceneStack } from "@/hooks/useSceneStack";
import { useLayerStore } from "@/stores/layerStore";
import { useInspectorSelectionStore } from "@/stores/inspectorSelectionStore";
import { getLayerService } from "@/services/LayerService";
import { removeLayerFromScene } from "@/services/layerRemoval";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import type { SceneItem } from "@/types/sceneItem";
import {
  IconButton,
  Notice,
  Section,
  useRovingFocus,
  type RovingItemProps,
  EmptyPane,
} from "@/components/ui/bf";
import { SceneStackItem } from "./SceneStackItem";
import { useReadoutPoint } from "@/hooks/useReadoutPoint";
import {
  formatVoxelIndex,
  voxelIndexInBounds,
  worldToVoxelIndex,
} from "@/utils/voxelSnap";
import { useIjkSuffix, useReadoutGrid } from "@/hooks/useReadoutGrid";

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
  // Unlinked Compare (P3.9): the scene's display edits belong to one panel.
  const compare = useCompareEditTarget();
  const meta =
    compare?.scope === "panel" && summary ? `Panel ${compare.letter} · ${summary}` : summary;

  // Reordering a volume changes its z-order: the layer-array order is the
  // render contract (index 0 = base/bottom). All the store + ViewState + render
  // plumbing already lives behind `layerService.reorderLayers`; the UI just
  // hands it the new id order. The dragged layer is marked as moved by the
  // user, so later loads never re-sort it. Surfaces/mappings are not
  // reorderable here.
  const handleVolumeReorder = useCallback((orderedIds: string[], movedId: string) => {
    void getLayerService()
      .moveLayerByUser(orderedIds, movedId)
      .catch((error) => {
        console.error("[SceneStack] Failed to reorder volume layers:", error);
      });
  }, []);

  // Right-click on a volume row: select it, then offer its layer actions.
  const handleVolumeContextMenu = useCallback(
    (item: SceneItem, event: React.MouseEvent) => {
      if (item.ref.type !== "volume") return;
      event.preventDefault();
      event.stopPropagation();
      setActive(item);
      const layerId = item.ref.layerId;
      const visible = useLayerStore.getState().getLayer(layerId)?.visible !== false;
      useContextMenuStore.getState().open(event.clientX, event.clientY, [
        {
          id: "layer.toggleVisible",
          label: visible ? "Hide layer" : "Show layer",
          onClick: () => getLayerService().toggleVisibility(layerId, !visible),
        },
        { id: "layer.sep", label: "", separator: true },
        {
          id: "layer.remove",
          label: "Remove layer",
          danger: true,
          onClick: () => void removeLayerFromScene(layerId),
        },
      ]);
    },
    [setActive],
  );

  // One tab stop for the whole scene list; arrows move across the groups.
  const ids = React.useMemo(
    () => [...volumes, ...surfaces, ...mappings].map((item) => item.id),
    [volumes, surfaces, mappings],
  );
  const roving = useRovingFocus({ ids, activeId: activeItemId });
  const rovingFor = roving.getItemProps;

  return (
    <Section
      title="Scene"
      icon={<SceneIcon />}
      defaultOpen
      meta={meta ?? undefined}
      divider={false}
    >
      <div onKeyDown={roving.onKeyDown}>
        <VolumeSceneGroup
          items={volumes}
          activeItemId={activeItemId}
          onSelect={setActive}
          onReorder={handleVolumeReorder}
          onContextMenu={handleVolumeContextMenu}
          rovingFor={rovingFor}
        />
        <SceneGroup
          title="Surface view"
          items={surfaces}
          emptyHint="No surfaces loaded"
          showWhenEmpty={false}
          activeItemId={activeItemId}
          onSelect={setActive}
          rovingFor={rovingFor}
        />
        <SceneGroup
          title="Mappings"
          items={mappings}
          emptyHint="No vol-to-surface mappings yet"
          showWhenEmpty={false}
          activeItemId={activeItemId}
          onSelect={setActive}
          rovingFor={rovingFor}
        />
      </div>
    </Section>
  );
}

type RovingFor = (id: string) => RovingItemProps;

function GroupTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-1 flex items-baseline gap-2 px-2 text-bf-xs text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Right-aligned caption naming where the row values are read (P3.6): "At
 * pointer · ijk 29, 57, 64 (zstat1)" while hovering a slice, else "At
 * crosshair". The ijk is on the selected layer's grid, named, like the
 * status bar's.
 */
function ReadoutCaption() {
  const { source, world } = useReadoutPoint();
  const grid = useReadoutGrid();
  const suffix = useIjkSuffix(grid);
  let ijk: string | null = null;
  if (source === "pointer" && grid) {
    const index = worldToVoxelIndex(world, grid);
    ijk = voxelIndexInBounds(index, grid.dims) ? formatVoxelIndex(index) : null;
  }
  // Prose in sans, the voxel numbers in mono.
  return (
    <>
      <span
        className="ml-auto"
        data-testid="scene-readout-caption"
        title={grid ? `Voxel on the grid of ${grid.name}` : undefined}
      >
        {source === "pointer" ? "At pointer" : "At crosshair"}
        {ijk && grid ? (
          <>
            {" · ijk "}
            <span className="font-mono tabular-nums">{ijk}</span>
            {` (${suffix ?? grid.label})`}
          </>
        ) : null}
      </span>
      <IconButton
        size="xs"
        variant="ghost"
        icon={<Copy />}
        aria-label="Copy values at crosshair"
        title="Copy every visible layer's value at the crosshair (TSV)"
        onClick={() => void copyValuesAtCrosshair()}
      />
    </>
  );
}

function SceneGroup({
  title,
  items,
  emptyHint,
  showWhenEmpty,
  activeItemId,
  onSelect,
  rovingFor,
}: {
  title: string;
  items: SceneItem[];
  emptyHint: string;
  showWhenEmpty: boolean;
  activeItemId: string | null;
  onSelect: (item: SceneItem) => void;
  rovingFor: RovingFor;
}) {
  const titleId = `scene-group-${useId().replace(/:/g, "")}`;
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <div className="mt-2 first:mt-0">
      <GroupTitle id={titleId}>{title}</GroupTitle>
      {items.length === 0 ? (
        <Notice role={undefined}>{emptyHint}</Notice>
      ) : (
        <div role="grid" aria-labelledby={titleId} className="flex flex-col gap-0.5">
          {items.map((item) => (
            <SceneStackItem
              key={item.id}
              item={item}
              selected={item.id === activeItemId}
              onSelect={() => onSelect(item)}
              roving={rovingFor(item.id)}
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
  onContextMenu,
  rovingFor,
}: {
  items: SceneItem[];
  activeItemId: string | null;
  onSelect: (item: SceneItem) => void;
  onReorder: (orderedIds: string[], movedId: string) => void;
  onContextMenu: (item: SceneItem, event: React.MouseEvent) => void;
  rovingFor: RovingFor;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  // Delete / Backspace removes the selected volume while focus is in the
  // list (never from a text field: the list holds none, but guard anyway).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    // A held key must not remove one layer per auto-repeat.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const item = items.find((candidate) => candidate.id === activeItemId);
    if (!item || item.ref.type !== "volume") return;
    event.preventDefault();
    event.stopPropagation();
    void removeLayerFromScene(item.ref.layerId);
  };
  const titleId = `scene-group-${useId().replace(/:/g, "")}`;
  const sensors = useSensors(
    // Small activation distance so a click still selects; only a real drag
    // gesture from the grip starts a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const ids = items.map((item) => item.id);
    // A quick flick can end before dnd-kit has measured a drop target
    // (`over` null, QA §5.2): resolve it from where the row was let go.
    let overId = over ? String(over.id) : null;
    const list = listRef.current;
    const start = active.rect.current.initial;
    if (!overId && list && start) {
      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-scene-sortable-id]")).map(
        (el) => {
          const rect = el.getBoundingClientRect();
          return { id: el.dataset.sceneSortableId ?? "", top: rect.top, bottom: rect.bottom };
        },
      );
      // Let go outside the list: cancel, never reorder.
      overId = dropTargetInList(rows, list.getBoundingClientRect(), {
        x: start.left + start.width / 2 + delta.x,
        y: start.top + start.height / 2 + delta.y,
      });
    }
    if (!overId || active.id === overId) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to), String(active.id));
  };

  return (
    <div className="mt-2 first:mt-0">
      {/* The grid is named by the stable title only, not the caption / Copy. */}
      <div className="mb-1 flex items-baseline gap-2 px-2 text-bf-xs text-muted-foreground">
        <span id={titleId}>Volume view</span>
        {items.length > 0 ? <ReadoutCaption /> : null}
      </div>
      {items.length === 0 ? (
        // No glyph (the Notice's ring read as loading): the one empty state,
        // left-aligned in the rail.
        <EmptyPane
          align="start"
          className="h-auto p-0 px-2"
          title="No volumes loaded"
          hint="Use + Load above, or double-click a file in Files."
        />
      ) : items.length === 1 ? (
        <div
          role="grid"
          aria-labelledby={titleId}
          className="flex flex-col gap-0.5"
          onKeyDown={handleKeyDown}
        >
          <SceneStackItem
            item={items[0]}
            selected={items[0].id === activeItemId}
            onSelect={() => onSelect(items[0])}
            roving={rovingFor(items[0].id)}
            onContextMenu={(event) => onContextMenu(items[0], event)}
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
            <div
              ref={listRef}
              role="grid"
              aria-labelledby={titleId}
              className="flex flex-col gap-0.5"
              onKeyDown={handleKeyDown}
            >
              {items.map((item) => (
                <SortableSceneStackItem
                  key={item.id}
                  item={item}
                  selected={item.id === activeItemId}
                  onSelect={() => onSelect(item)}
                  roving={rovingFor(item.id)}
                  onContextMenu={(event) => onContextMenu(item, event)}
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
  roving,
  onContextMenu,
}: {
  item: SceneItem;
  selected: boolean;
  onSelect: () => void;
  roving: RovingItemProps;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
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
      className="-ml-2 -mr-1 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--bf-border-focus)] group-hover:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} data-scene-sortable-id={item.id}>
      <SceneStackItem
        item={item}
        selected={selected}
        onSelect={onSelect}
        dragHandle={handle}
        roving={roving}
        onContextMenu={onContextMenu}
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
