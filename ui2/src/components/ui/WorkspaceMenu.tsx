/**
 * WorkspaceMenu — single top-bar dropdown for adding tabs and for saved
 * GoldenLayout trees (Design.md §6.1 specifies a single workspace dropdown).
 *
 *   New view (Cmd/Ctrl+T)
 *   TOOLS                 ← Set studio (5), BIDS (6), then module tools: open once,
 *                           then refocus. A module tool that is not stable is
 *                           labelled with its stage (modules/registry.ts).
 *   ──────────────
 *   LAYOUTS               ← save / load / rename / delete GoldenLayout trees
 *
 * Layouts of the current tab (Orthogonal, Mosaic, …) live on the top-bar pills
 * and Cmd/Ctrl+1–4, which this menu registers in the browser build. The former
 * Read / Explore / Analyze / Compare presets were dropped: each opened a tab in
 * a layout, duplicating the pills under other names (see
 * services/workspaceNavigation.ts and qa-design-decisions-2026-10-30 §1).
 */

import React, { useEffect } from "react";
import {
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";

import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { getConfirmationService } from "@/services/ConfirmationService";
import { getKeyboardShortcutService } from "@/services/KeyboardShortcutService";
import {
  getLayoutLibraryLastError,
  useLayoutLibraryStore,
} from "@/stores/layoutLibraryStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  LAYOUT_SHORTCUT_MODES,
  isModalDialogOpen,
  nativeMenuOwnsNavigationShortcuts,
  openNewView,
  openTool,
  setCurrentTabLayout,
  toolDestinations,
  type ToolDestination,
} from "@/services/workspaceNavigation";
import { moduleStageLabel, useTools } from "@/modules/registry";
import { DISPLAY_MODES } from "@/types/displayModes";
import { cn } from "@/utils/cn";
import { Button } from "./Button";
import { formatShortcut } from "@/components/dialogs/commandPaletteMatch";

const SHORTCUT_CATEGORY = "Views and tools";

interface NavigationShortcut {
  id: string;
  key: string;
  description: string;
  handler: () => void;
}

/**
 * Cmd/Ctrl+T, Cmd/Ctrl+1–4 (layouts) and Cmd/Ctrl+5–6 (tools). Only core tools
 * carry a shortcut digit, so the list is fixed.
 */
const navigationShortcuts = (): NavigationShortcut[] => [
  {
    id: "workspace.newView",
    key: "t",
    description: "New view",
    handler: () => void openNewView(),
  },
  ...LAYOUT_SHORTCUT_MODES.map((mode, index) => ({
    id: `workspace.layout.${mode}`,
    key: String(index + 1),
    description: `Layout: ${DISPLAY_MODES[mode].label}`,
    handler: () => {
      setCurrentTabLayout(mode);
    },
  })),
  ...toolDestinations()
    .filter((tool) => tool.shortcutKey)
    .map((tool) => ({
      id: `workspace.tool.${tool.type}`,
      key: tool.shortcutKey!,
      description: `Open ${tool.label}`,
      handler: () => void openTool(tool.type),
    })),
];

interface WorkspaceMenuProps {
  className?: string;
}

export function WorkspaceMenu({ className }: WorkspaceMenuProps) {
  const activeWorkspaceType = useWorkspaceStore((state) => {
    const id = state.activeWorkspaceId;
    return id ? (state.workspaces.get(id)?.type ?? null) : null;
  });
  const tools = useTools();

  // Saved layouts
  const layouts = useLayoutLibraryStore((state) => state.layouts);
  const activeLayoutId = useLayoutLibraryStore((state) => state.activeLayoutId);
  const saveCurrentLayout = useLayoutLibraryStore(
    (state) => state.saveCurrentLayout,
  );
  const loadLayout = useLayoutLibraryStore((state) => state.loadLayout);
  const renameLayout = useLayoutLibraryStore((state) => state.renameLayout);
  const deleteLayout = useLayoutLibraryStore((state) => state.deleteLayout);
  const clearError = useLayoutLibraryStore((state) => state.clearError);

  // In the desktop shell the native menu owns these accelerators; registering
  // them here too could fire New view twice for one key press.
  useEffect(() => {
    if (nativeMenuOwnsNavigationShortcuts()) return;
    const keyboard = getKeyboardShortcutService();
    const unregisterFns = navigationShortcuts().flatMap((shortcut) =>
      (["meta", "ctrl"] as const).map((modifier) =>
        keyboard.register({
          id: `${shortcut.id}.${modifier}`,
          key: shortcut.key,
          modifiers: { [modifier]: true },
          category: SHORTCUT_CATEGORY,
          description: shortcut.description,
          // Never change the tabs behind an open dialog.
          handler: () => {
            if (!isModalDialogOpen()) shortcut.handler();
          },
        }),
      ),
    );
    return () => {
      unregisterFns.forEach((unregister) => unregister());
    };
  }, []);

  const showLastError = () => {
    const lastError = getLayoutLibraryLastError();
    if (lastError) {
      getConfirmationService().showError(lastError);
      clearError();
    }
  };

  const promptSaveLayout = async () => {
    const suggestedName = `Layout ${new Date().toLocaleString()}`;
    const name =
      await getConfirmationService().promptLayoutSaveName(suggestedName);
    if (!name) return;
    const ok = saveCurrentLayout(name);
    if (!ok) showLastError();
  };

  const promptRenameLayout = async (layoutId: string, currentName: string) => {
    const nextName =
      await getConfirmationService().promptLayoutRename(currentName);
    if (!nextName || nextName === currentName) return;
    const ok = renameLayout(layoutId, nextName);
    if (!ok) showLastError();
  };

  const promptDeleteLayout = (layoutId: string, name: string) => {
    void getConfirmationService()
      .confirmLayoutDeletion(name)
      .then((confirmed) => {
        if (!confirmed) return;
        const ok = deleteLayout(layoutId);
        if (!ok) showLastError();
      });
  };

  const shortcutLabel = (label: React.ReactNode, shortcut?: string) => (
    <div className="flex min-w-56 items-center justify-between gap-6">
      <span>{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-bf-2xs text-muted-foreground">
          {/* ⌘T on macOS, Ctrl+T elsewhere (QA 2026-10-30 F41). */}
          {formatShortcut(shortcut)}
        </span>
      ) : null}
    </div>
  );

  const toolItem = (tool: ToolDestination): DropdownMenuItem => ({
    id: `workspace.tool.${tool.type}`,
    label: shortcutLabel(
      `${tool.type === activeWorkspaceType ? "● " : ""}${tool.label}`,
      tool.shortcutKey
        ? `Cmd/Ctrl+${tool.shortcutKey}`
        : (moduleStageLabel(tool.stage) ?? undefined),
    ),
    onClick: () => {
      void openTool(tool.type);
    },
  });

  const items: DropdownMenuItem[] = [
    {
      id: "workspace.newView",
      label: shortcutLabel("New view", "Cmd/Ctrl+T"),
      onClick: () => {
        void openNewView();
      },
    },
    { id: "workspace.sep.tools", separator: true as const },
    { id: "workspace.header.tools", header: true, label: "Tools" },
    ...tools.map(toolItem),
    { id: "workspace.sep.layouts", separator: true as const },
    { id: "workspace.header.layouts", header: true, label: "Layouts" },
    {
      id: "layout.save",
      label: "Save Current Layout…",
      icon: <Save className="h-3.5 w-3.5" />,
      onClick: () => {
        void promptSaveLayout();
      },
    },
    ...(layouts.length > 0
      ? layouts.map((layout) => ({
          id: `layout.load.${layout.id}`,
          label: `${layout.id === activeLayoutId ? "● " : ""}${layout.name}`,
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          onClick: () => {
            const ok = loadLayout(layout.id);
            if (!ok) showLastError();
          },
        }))
      : [{ id: "layout.none", label: "No saved layouts", disabled: true }]),
    ...(layouts.length > 0
      ? [
          { id: "layout.sep.manage", separator: true as const },
          ...layouts.map((layout) => ({
            id: `layout.rename.${layout.id}`,
            label: `Rename: ${layout.name}`,
            icon: <Pencil className="h-3.5 w-3.5" />,
            onClick: () => {
              void promptRenameLayout(layout.id, layout.name);
            },
          })),
          ...layouts.map((layout) => ({
            id: `layout.delete.${layout.id}`,
            label: `Delete: ${layout.name}`,
            icon: <Trash2 className="h-3.5 w-3.5" />,
            danger: true,
            onClick: () => promptDeleteLayout(layout.id, layout.name),
          })),
        ]
      : []),
  ];

  return (
    <DropdownMenu
      position="bottom-right"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={cn("status-toggle--workspace", className)}
          aria-label="Workspace and layouts"
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
        >
          <span>Workspace</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      }
      items={items}
    />
  );
}

export default WorkspaceMenu;
