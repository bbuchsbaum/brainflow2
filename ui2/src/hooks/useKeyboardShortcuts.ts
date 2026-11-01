/**
 * useKeyboardShortcuts Hook
 * Global keyboard shortcuts for the application.
 * Uses KeyboardShortcutService for centralized registration.
 */

import { useEffect } from "react";
import { useTimeNavigation } from "./useTimeNavigation";
import { getTimeNavigationService } from "@/services/TimeNavigationService";
import { getSliceNavigationService } from "@/services/SliceNavigationService";
import { getEventBus } from "@/events/EventBus";
import { getKeyboardShortcutService } from "@/services/KeyboardShortcutService";
import { useActiveRenderContextStore } from "@/stores/activeRenderContextStore";
import { useMouseCoordinateStore } from "@/stores/mouseCoordinateStore";
import { useLayoutStateStore } from "@/stores/layoutStateStore";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";
import type { ViewType } from "@/types/coordinates";
import { isViewerKeyTarget, navigationKeyTarget } from "@/utils/viewerKeyTarget";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { mosaicAxisOf } from "@/utils/mosaicAxis";
import { isTextEditingElement, selectAllInFocusedField } from "@/utils/editSelectAll";
import { safeListen, safeUnlisten, type Unlisten } from "@/utils/eventUtils";

const CATEGORY = "Time Navigation";
const SLICE_SHORTCUT_CATEGORY = "Slice Navigation";
const PLOT_SHORTCUT_CATEGORY = "Plot";

const SLICE_VIEWS: ReadonlySet<ViewType> = new Set([
  "axial",
  "sagittal",
  "coronal",
]);

export function resolveActiveSliceView(): ViewType {
  // A Mosaic tab in front: its own slicing axis (QA 2026-10-31).
  const workspaces = useWorkspaceStore.getState();
  const front = workspaces.activeWorkspaceId ? workspaces.getWorkspace(workspaces.activeWorkspaceId) : null;
  if (front?.type === "mosaic") return mosaicAxisOf(front.id) ?? "axial";
  const activeRenderable = useActiveRenderContextStore.getState().activeId;
  if (activeRenderable && SLICE_VIEWS.has(activeRenderable as ViewType)) {
    return activeRenderable as ViewType;
  }

  const mouseActive = useMouseCoordinateStore.getState().activeView;
  if (mouseActive) {
    return mouseActive;
  }

  return useLayoutStateStore.getState().layoutState.activeView;
}

/** Scene undo / redo (loaded on first use: the history pulls in the layer services). */
function editCommand(action: "undo" | "redo", from: "key" | "menu"): void {
  void import("@/services/SceneHistoryService").then(({ runEditCommand }) => runEditCommand(action, from));
}

function nudgeSlice(stepMultiplier: number): void {
  const viewId = resolveActiveSliceView();
  // One reference voxel per step (the snapping grid), always moving.
  getSliceNavigationService().stepSlice(viewId, stepMultiplier);
}

export function useKeyboardShortcuts() {
  const timeNav = useTimeNavigation();
  const service = getKeyboardShortcutService();

  // Edit › Select All (native, Cmd/Ctrl+A): the focused text field only.
  useEffect(() => {
    let disposed = false;
    let unlisten: Unlisten | undefined;
    void safeListen<{ action?: string }>("edit-action", (event) => {
      const action = event.payload?.action;
      if (action === "select-all") selectAllInFocusedField();
      else if (action === "undo" || action === "redo") editCommand(action, "menu");
    }).then((fn) => {
      if (disposed) void safeUnlisten(fn);
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      void safeUnlisten(unlisten);
    };
  }, []);

  useEffect(() => {
    const has4D = () => timeNav.has4DVolume();
    const isTimeMode = () =>
      has4D() && getTimeNavigationService().getMode() === "time";

    const unregisterFns = [
      service.register({
        id: "time.prev",
        key: "ArrowLeft",
        category: CATEGORY,
        description: "Previous timepoint",
        priority: 20,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().previousTimepoint();
        },
      }),
      service.register({
        id: "time.next",
        key: "ArrowRight",
        category: CATEGORY,
        description: "Next timepoint",
        priority: 20,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().nextTimepoint();
        },
      }),
      service.register({
        id: "time.prev10",
        key: "ArrowLeft",
        modifiers: { shift: true },
        category: CATEGORY,
        description: "Jump 10 timepoints backward",
        priority: 30,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().jumpTimepoints(-10);
        },
      }),
      service.register({
        id: "time.next10",
        key: "ArrowRight",
        modifiers: { shift: true },
        category: CATEGORY,
        description: "Jump 10 timepoints forward",
        priority: 30,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().jumpTimepoints(10);
        },
      }),
      service.register({
        id: "slice.prev",
        key: "ArrowLeft",
        category: SLICE_SHORTCUT_CATEGORY,
        description: "Previous slice in active view",
        priority: 10,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(-1);
        },
      }),
      service.register({
        id: "slice.next",
        key: "ArrowRight",
        category: SLICE_SHORTCUT_CATEGORY,
        description: "Next slice in active view",
        priority: 10,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(1);
        },
      }),
      service.register({
        id: "slice.prev10",
        key: "ArrowLeft",
        modifiers: { shift: true },
        category: SLICE_SHORTCUT_CATEGORY,
        description: "Jump 10 slices backward in active view",
        priority: 15,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(-10);
        },
      }),
      service.register({
        id: "slice.next10",
        key: "ArrowRight",
        modifiers: { shift: true },
        category: SLICE_SHORTCUT_CATEGORY,
        description: "Jump 10 slices forward in active view",
        priority: 15,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(10);
        },
      }),
      // Up/Down step slices in either navigation mode (Left/Right step time
      // in time mode); PageUp/PageDown jump 10, like Shift+arrow. Only with
      // focus on a view or on nothing: trees, lists, the Log and scrolling
      // panels keep these keys (utils/viewerKeyTarget).
      ...(
        [
          ["slice.up", "ArrowUp", undefined, 1, "Next slice in active view"],
          ["slice.down", "ArrowDown", undefined, -1, "Previous slice in active view"],
          ["slice.up10", "ArrowUp", { shift: true }, 10, "Jump 10 slices forward in active view"],
          ["slice.down10", "ArrowDown", { shift: true }, -10, "Jump 10 slices backward in active view"],
          ["slice.pageUp", "PageUp", undefined, 10, "Jump 10 slices forward in active view"],
          ["slice.pageDown", "PageDown", undefined, -10, "Jump 10 slices backward in active view"],
        ] as const
      ).map(([id, key, modifiers, steps, description]) =>
        service.register({
          id,
          key,
          modifiers,
          category: SLICE_SHORTCUT_CATEGORY,
          description,
          priority: 10,
          when: () => isViewerKeyTarget(navigationKeyTarget()),
          handler: () => {
            nudgeSlice(steps);
          },
        }),
      ),
      // Cmd/Ctrl+A outside a text field would select every label in every
      // panel (QA 2026-10-29 §4.3); there is nothing in the viewer to select.
      // Text fields keep their own Select All (shortcuts skip inputs).
      ...(["meta", "ctrl"] as const).map((modifier) =>
        service.register({
          id: `app.selectAll.${modifier}`,
          key: "a",
          modifiers: { [modifier]: true },
          category: "General",
          description: "Select all (text fields only)",
          handler: () => {
            window.getSelection()?.removeAllRanges();
          },
        }),
      ),
      // ⌘Z / ⇧⌘Z (Ctrl on other platforms): the scene history. Sliders,
      // switches and selects count as the scene; text fields keep their own
      // undo (no match there, so the key reaches the field).
      ...(["meta", "ctrl"] as const).flatMap((modifier) =>
        (["undo", "redo"] as const).map((action) =>
          service.register({
            id: `edit.${action}.${modifier}`,
            key: "z",
            modifiers: action === "redo" ? { [modifier]: true, shift: true } : { [modifier]: true },
            category: "General",
            description: action === "undo" ? "Undo scene edit" : "Redo scene edit",
            allowInInputs: true,
            when: () => !isTextEditingElement(document.activeElement),
            handler: () => editCommand(action, "key"),
          }),
        ),
      ),
      service.register({
        id: "plot.toggleDock",
        key: "p",
        category: PLOT_SHORTCUT_CATEGORY,
        description: "Show/hide the bottom dock",
        handler: () => {
          const settings = useLayoutSettingsStore.getState();
          const willOpen = !settings.bottomDockOpen;
          settings.toggleBottomDock();
          getEventBus().emit("ui.notification", {
            type: "info",
            message: willOpen ? "Bottom dock shown" : "Bottom dock hidden",
            durationMs: 1000,
          });
        },
      }),
      service.register({
        id: "time.playPause",
        key: " ",
        category: CATEGORY,
        // Over a slice view Space acts on release (held, it pans; useViewPanZoom).
        description: "Play/pause time animation (over a view: on release; hold to pan)",
        handler: () => {
          getEventBus().emit("playback.toggle", {});
        },
      }),
      service.register({
        id: "time.toggleMode",
        key: "t",
        category: CATEGORY,
        description: "Toggle time/slice navigation mode",
        handler: () => {
          const timeNavSvc = getTimeNavigationService();
          timeNavSvc.toggleMode();
          const mode = timeNavSvc.getMode();
          getEventBus().emit("ui.notification", {
            type: "info",
            message: `Scroll wheel: ${mode === "time" ? "Time navigation" : "Slice navigation"}`,
            durationMs: 1000,
          });
        },
      }),
    ];

    return () => {
      unregisterFns.forEach((fn) => fn());
    };
    // Re-register when timeNav identity changes (i.e. when has4DVolume predicate changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeNav]);
}
