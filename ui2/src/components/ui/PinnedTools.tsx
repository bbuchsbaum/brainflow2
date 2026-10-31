/**
 * PinnedTools — compact top-bar buttons for the tools pinned in Settings ›
 * Top bar (`modules/settingsStore.ts`). A click opens the tool, or focuses its
 * tab. Unpinned tools stay in the Workspace menu and the native menu; a pinned
 * tool whose module is off shows no button. Renders nothing when no tool is
 * pinned (the default).
 */

import React, { useMemo } from 'react';
import { Button, SELECTED_FILL } from '@/components/ui/bf';
import { useTools } from '@/modules/registry';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { openTool } from '@/services/workspaceNavigation';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { cn } from '@/utils/cn';

export function PinnedTools() {
  const tools = useTools();
  const pinned = useModuleSettingsStore((s) => s.pinned);
  const activeType = useWorkspaceStore((state) => {
    const id = state.activeWorkspaceId;
    return id ? (state.workspaces.get(id)?.type ?? null) : null;
  });
  // Menu order, not pin order, so the buttons never reshuffle.
  const shown = useMemo(() => tools.filter((tool) => pinned.includes(tool.type)), [tools, pinned]);
  if (shown.length === 0) return null;

  return (
    <div role="group" aria-label="Pinned tools" data-testid="top-app-bar-pinned" className="flex items-center gap-1">
      {shown.map((tool) => {
        const active = tool.type === activeType;
        return (
          <Button
            key={tool.type}
            variant="ghost"
            size="sm"
            aria-current={active ? 'page' : undefined}
            title={active ? `${tool.label} is open` : `Open ${tool.label}`}
            className={cn(active && SELECTED_FILL, active && 'text-foreground')}
            onClick={() => {
              void openTool(tool.type);
            }}
          >
            {tool.shortLabel}
          </Button>
        );
      })}
    </div>
  );
}

export default PinnedTools;
