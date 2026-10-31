/**
 * The tab body of a module's tool (WorkspaceRouter's route for every
 * non-core workspace type). Activates the module on first use and renders the
 * contribution's component (lazily loaded) once the module is active, so the
 * module never calls its bridge commands before the bridge has switched it
 * on. A module that is switched off has its tabs parked, so the "switched off"
 * state shows only in the moment between the switch and the park.
 */

import React, { Suspense, useEffect } from 'react';
import { CenterWithBottomDock } from '@/components/layout/CenterWithBottomDock';
import { moduleRegistry, useModuleRegistryVersion } from '@/modules/registry';
import { lazyComponent } from '@/modules/lazyComponent';
import { EmptyPane } from '@/components/ui/bf';
import { formatTauriError } from '@/utils/formatTauriError';

export interface ModuleWorkspaceProps {
  workspaceId: string;
  workspaceType: string;
}

export function ModuleWorkspace({ workspaceId, workspaceType }: ModuleWorkspaceProps) {
  useModuleRegistryVersion();
  const tool = moduleRegistry.getModuleTool(workspaceType);
  const enabled = tool ? moduleRegistry.isEnabled(tool.moduleId) : false;
  const active = tool ? moduleRegistry.isActive(tool.moduleId) : false;
  const failure = tool ? moduleRegistry.activationError(tool.moduleId) : null;

  useEffect(() => {
    if (!tool || !enabled || active) return;
    // The registry logs and records failures (shown below).
    moduleRegistry.ensureActive(tool.moduleId).catch(() => undefined);
  }, [tool, enabled, active]);

  if (!tool) {
    return (
      <div
        data-testid="workspace-router-unknown"
        className="flex h-full items-center justify-center text-muted-foreground"
      >
        Unknown workspace type: {workspaceType}
      </div>
    );
  }
  if (!enabled) {
    return (
      <EmptyPane
        data-testid="module-workspace-off"
        title={`${tool.label} is switched off`}
        hint="Switch it on in Settings › Modules."
      />
    );
  }

  if (failure) {
    return (
      <EmptyPane
        data-testid="module-workspace-failed"
        title={`${tool.label} could not start`}
        hint={formatTauriError(failure)}
      />
    );
  }
  if (!active) return null;

  const Body = lazyComponent(tool.component);
  const body = (
    <Suspense fallback={null}>
      <Body workspaceId={workspaceId} />
    </Suspense>
  );
  return tool.bottomDock ? <CenterWithBottomDock>{body}</CenterWithBottomDock> : body;
}
