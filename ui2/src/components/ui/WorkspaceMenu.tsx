/**
 * WorkspaceMenu — single top-bar dropdown that merges the former
 * "Workspace Preset" and "Layouts" controls into one menu (Design.md §6.1,
 * which specifies a single workspace dropdown).
 *
 *   OPEN WORKSPACE        ← the six workspace presets (Cmd/Ctrl+1..6)
 *   ──────────────
 *   LAYOUTS               ← save / load / rename / delete GoldenLayout trees
 *
 * Presets create-or-activate a workspace; layouts capture and restore the
 * GoldenLayout panel arrangement. Keyboard shortcuts for presets are
 * registered here (previously owned by WorkspacePresetSelector).
 */

import React, { useEffect, useMemo } from "react";
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
import { isViewWorkspaceType } from "@/components/ui/displayModeSelector.helpers";
import {
  WORKSPACE_PRESETS,
  type WorkspacePreset,
  type WorkspacePresetId,
} from "@/types/workspacePresets";
import { cn } from "@/utils/cn";

const PRESET_ORDER: WorkspacePresetId[] = [
  "read",
  "explore",
  "analyze",
  "compare",
  "studio",
  "bids",
];
const SHORTCUT_CATEGORY = "Workspace Presets";

interface WorkspaceMenuProps {
  className?: string;
}

export function WorkspaceMenu({ className }: WorkspaceMenuProps) {
  // Workspace presets
  const applyWorkspacePreset = useWorkspaceStore(
    (state) => state.applyWorkspacePreset,
  );
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const workspaces = useWorkspaceStore((state) => state.workspaces);

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

  const activePresetId = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.get(activeWorkspaceId)?.presetId ?? null;
  }, [activeWorkspaceId, workspaces]);

  // Preset keyboard shortcuts (Cmd/Ctrl+1..6) — ported from the former
  // WorkspacePresetSelector so the merge keeps the shortcuts working.
  useEffect(() => {
    const keyboard = getKeyboardShortcutService();
    const unregisterFns = PRESET_ORDER.flatMap((presetId, index) => {
      const preset = WORKSPACE_PRESETS[index];
      const key = String(index + 1);
      const handler = () => {
        void applyWorkspacePreset(presetId);
      };

      return [
        keyboard.register({
          id: `workspace.preset.${presetId}.meta`,
          key,
          modifiers: { meta: true },
          category: SHORTCUT_CATEGORY,
          description: `Switch to ${preset.label} preset`,
          handler,
        }),
        keyboard.register({
          id: `workspace.preset.${presetId}.ctrl`,
          key,
          modifiers: { ctrl: true },
          category: SHORTCUT_CATEGORY,
          description: `Switch to ${preset.label} preset`,
          handler,
        }),
      ];
    });

    return () => {
      unregisterFns.forEach((unregister) => unregister());
    };
  }, [applyWorkspacePreset]);

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

  // A preset is a "view" when its workspace type is governed by the top-bar mode
  // pill (orthogonal / mosaic / comparison); the rest are tool destinations.
  // Grouping the menu this way mirrors the pill-vs-tabs division of labour.
  const presetItem = (preset: WorkspacePreset): DropdownMenuItem => ({
    id: `workspace.preset.${preset.id}`,
    label: (
      <div className="flex min-w-56 items-center justify-between gap-6">
        <span>
          {preset.id === activePresetId ? "● " : ""}
          {preset.label}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {preset.shortcut}
        </span>
      </div>
    ),
    onClick: () => {
      void applyWorkspacePreset(preset.id);
    },
  });

  const viewPresets = WORKSPACE_PRESETS.filter((preset) =>
    isViewWorkspaceType(preset.workspaceType),
  );
  const toolPresets = WORKSPACE_PRESETS.filter(
    (preset) => !isViewWorkspaceType(preset.workspaceType),
  );

  const items: DropdownMenuItem[] = [
    { id: "workspace.header.views", header: true, label: "Open view" },
    ...viewPresets.map(presetItem),
    { id: "workspace.sep.tools", separator: true as const },
    { id: "workspace.header.tools", header: true, label: "Tools" },
    ...toolPresets.map(presetItem),
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
        <button
          type="button"
          className={cn("status-toggle status-toggle--workspace", className)}
          aria-label="Workspace and layouts"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Workspace</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      }
      items={items}
    />
  );
}

export default WorkspaceMenu;
