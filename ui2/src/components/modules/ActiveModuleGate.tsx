/**
 * Renders a module's UI (tab, Inspector body or mode, dock tab) only once the
 * module is active. It activates the module on first render; activation waits
 * until the bridge has applied the latest `set_enabled_modules`, so module
 * code never calls its bridge commands while the bridge still rejects them.
 * A failed activation shows why; nothing shows while the module starts.
 */

import React, { useEffect } from 'react';
import { EmptyPane } from '@/components/ui/bf';
import { moduleRegistry, useModuleRegistryVersion } from '@/modules/registry';
import { formatTauriError } from '@/utils/formatTauriError';

export interface ActiveModuleGateProps {
  moduleId: string;
  /** Names the module in the failure state. */
  label: string;
  children: React.ReactNode;
}

export function ActiveModuleGate({ moduleId, label, children }: ActiveModuleGateProps) {
  useModuleRegistryVersion();
  const enabled = moduleRegistry.isEnabled(moduleId);
  const active = moduleRegistry.isActive(moduleId);
  const failure = moduleRegistry.activationError(moduleId);

  useEffect(() => {
    if (!enabled || active) return;
    // The registry logs and records failures (shown below).
    moduleRegistry.ensureActive(moduleId).catch(() => undefined);
  }, [moduleId, enabled, active]);

  if (!enabled) return null;
  if (active) return <>{children}</>;
  if (failure) {
    return (
      <EmptyPane
        data-testid="module-workspace-failed"
        title={`${label} could not start`}
        hint={formatTauriError(failure)}
      />
    );
  }
  return null;
}
