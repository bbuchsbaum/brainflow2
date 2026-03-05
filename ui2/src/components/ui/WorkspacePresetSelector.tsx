import React, { useEffect, useMemo } from 'react';
import { ChevronDown, LayoutTemplate } from 'lucide-react';
import { DropdownMenu } from './DropdownMenu';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WORKSPACE_PRESETS, type WorkspacePresetId } from '@/types/workspacePresets';
import { cn } from '@/utils/cn';

const PRESET_ORDER: WorkspacePresetId[] = ['read', 'explore', 'analyze', 'compare'];
const SHORTCUT_CATEGORY = 'Workspace Presets';

interface WorkspacePresetSelectorProps {
  className?: string;
}

export function WorkspacePresetSelector({ className }: WorkspacePresetSelectorProps) {
  const applyWorkspacePreset = useWorkspaceStore((state) => state.applyWorkspacePreset);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  const activePresetId = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }
    return workspaces.get(activeWorkspaceId)?.presetId ?? null;
  }, [activeWorkspaceId, workspaces]);

  const activePreset = useMemo(() => {
    if (!activePresetId) {
      return null;
    }
    return WORKSPACE_PRESETS.find((preset) => preset.id === activePresetId) ?? null;
  }, [activePresetId]);

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

  return (
    <DropdownMenu
      position="top-right"
      trigger={
        <button
          type="button"
          className={cn('status-toggle status-toggle--preset', className)}
          aria-label="Select workspace preset"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          <span>{activePreset ? `Preset: ${activePreset.label}` : 'Workspace Preset'}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      }
      items={WORKSPACE_PRESETS.map((preset) => ({
        id: preset.id,
        label: (
          <div className="flex min-w-64 items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-[11px] uppercase tracking-[0.08em]">
                {preset.label}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground whitespace-normal">
                {preset.description}
              </div>
            </div>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {preset.shortcut}
            </span>
          </div>
        ),
        onClick: () => {
          void applyWorkspacePreset(preset.id);
        },
      }))}
    />
  );
}
