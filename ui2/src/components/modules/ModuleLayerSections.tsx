import { Suspense } from 'react';
import { moduleRegistry, useModuleRegistryVersion } from '@/modules/registry';
import { lazyComponent } from '@/modules/lazyComponent';
import { Section } from '@/components/ui/bf';
import { ActiveModuleGate } from './ActiveModuleGate';

/** The shell owns placement and activation; the module owns each section body. */
export function ModuleLayerSections({ kindId, layerId }: { kindId: string; layerId: string }) {
  useModuleRegistryVersion();
  const kind = moduleRegistry.getLayerKind(kindId);
  if (!kind?.inspectorSections?.length) return null;
  return <ActiveModuleGate moduleId={kind.moduleId} label={kind.title}>
    {kind.inspectorSections.map((section) => {
      const Body = lazyComponent(section.component);
      return <Section key={section.id} title={section.title} defaultOpen>
        <Suspense fallback={null}><Body layerId={layerId} /></Suspense>
      </Section>;
    })}
  </ActiveModuleGate>;
}
