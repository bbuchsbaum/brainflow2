import { Suspense } from 'react';
import type { RegisteredViewMode } from '@/modules/registry';
import { lazyComponent } from '@/modules/lazyComponent';
import { CenterWithBottomDock } from '@/components/layout/CenterWithBottomDock';
import { ActiveModuleGate } from './ActiveModuleGate';

/** A module supplies the view layout; the shell keeps the workspace and dock. */
export function ModuleViewMode({ mode, workspaceId }: { mode: RegisteredViewMode; workspaceId: string }) {
  const Layout = lazyComponent(mode.component);
  return (
    <CenterWithBottomDock>
      <ActiveModuleGate moduleId={mode.moduleId} label={mode.title}>
        <Suspense fallback={null}>
          <Layout workspaceId={workspaceId} />
        </Suspense>
      </ActiveModuleGate>
    </CenterWithBottomDock>
  );
}
