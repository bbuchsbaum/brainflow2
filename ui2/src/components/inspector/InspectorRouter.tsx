import React, { Suspense, useState } from 'react';
import { getTransport } from '@/services/transport';
import { getEventBus } from '@/events/EventBus';
import { formatTauriError } from '@/utils/formatTauriError';
import { AtlasPicker, ProjectionPicker } from './imaging/InspectorLoadDialogs';
import { useDisplayMode } from '@/hooks/useDisplayMode';
import { useSceneStack } from '@/hooks/useSceneStack';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { StudioInspectorPanel } from '@/components/studio/StudioInspectorPanel';
import { LoadSheet } from './imaging/LoadSheet';
import { BidsInspector } from './bids/BidsInspector';
import { ImagingInspector } from './imaging/ImagingInspector';
import { Button, TabPanel, Tabs } from '@/components/ui/bf';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import {
  moduleRegistry,
  useModuleRegistryVersion,
  type ModuleInspectorMode,
} from '@/modules/registry';
import { lazyComponent } from '@/modules/lazyComponent';
import { ActiveModuleGate } from '@/components/modules/ActiveModuleGate';

/**
 * Right-rail Inspector shell. Owns the chrome:
 *   - a thin context toolbar: flat mode tabs (`Inspect | Annotate`, plus any
 *     mode an enabled module registers; they switch the pane's content, so
 *     they are tabs by the V5 taxonomy, not a segmented value choice) + the
 *     `+ Load` action. Annotate is unfinished and shows only with Settings ›
 *     Experimental features on; with a single mode the tabs are hidden and
 *     the body is the Inspector alone.
 *   - the scrollable body (Inspector or Annotate)
 *   - the footer (`N scene items` / `M selected`)
 *
 * The dock tab itself carries the word "INSPECTOR" — we deliberately do
 * NOT repeat it inside the panel. Active workspace context (Compare,
 * Mosaic, Studio, …) is conveyed by the workspace tab in the center
 * stack and the eventual left mode rail; surfacing it here too would be
 * the same redundancy.
 *
 * The body dispatches on the active workspace's display mode:
 *   - imaging modes (orthogonal / integrated / mosaic / compare) → `<ImagingInspector />`
 *   - set-studio → existing `<StudioInspectorPanel />`, unchanged
 *   - bids → `<BidsInspector />` placeholder
 *   - a module's tool tab → the inspector body its manifest declares
 */
/** Id base of the Inspect / Annotate tabs and their panels. */
const MODE_TABS_ID = 'inspector-mode';

export function InspectorRouter() {
  const [topLevelMode, setTopLevelMode] = useState<string>('inspector');
  const [loadOpen, setLoadOpen] = useState(false);
  const experimental = useFeatureFlagStore((s) => s.experimentalFeatures);
  useModuleRegistryVersion();
  const modes = moduleRegistry
    .getInspectorModes()
    .filter((m) => experimental || !m.experimental);
  const showModeTabs = modes.length > 1;
  const mode = showModeTabs && modes.some((m) => m.id === topLevelMode) ? topLevelMode : 'inspector';

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      aria-label="Inspector"
    >
      <ContextToolbar
        modes={showModeTabs ? modes : null}
        topLevelMode={mode}
        onSelectMode={setTopLevelMode}
        onOpenLoad={() => setLoadOpen((p) => !p)}
        loadOpen={loadOpen}
        onCloseLoad={() => setLoadOpen(false)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showModeTabs ? (
          modes.map((m) => (
            <TabPanel key={m.id} idBase={MODE_TABS_ID} value={m.id} selected={mode} focusable={false}>
              <InspectorModeBody mode={m} />
            </TabPanel>
          ))
        ) : (
          <InspectorBody />
        )}
      </div>

      <InspectorFooter />
    </section>
  );
}

/** The body of one Inspector mode: core modes here, module modes lazily. */
function InspectorModeBody({ mode }: { mode: ModuleInspectorMode }) {
  if (mode.id === 'inspector') return <InspectorBody />;
  if (mode.id === 'annotate') return <AnnotateBody />;
  if (!mode.component || !mode.moduleId) return null;
  const Body = lazyComponent(mode.component);
  return (
    <ActiveModuleGate moduleId={mode.moduleId} label={mode.title}>
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </ActiveModuleGate>
  );
}

function ContextToolbar({
  modes,
  topLevelMode,
  onSelectMode,
  onOpenLoad,
  loadOpen,
  onCloseLoad,
}: {
  /** The mode tabs, or null when there is a single mode. */
  modes: readonly ModuleInspectorMode[] | null;
  topLevelMode: string;
  onSelectMode: (mode: string) => void;
  onOpenLoad: () => void;
  loadOpen: boolean;
  onCloseLoad: () => void;
}) {
  const [dialog, setDialog] = useState<'atlas' | 'projection' | null>(null);
  const openFile = () => {
    void getTransport().invoke('open_file_dialog').catch((error: unknown) => {
      getEventBus().emit('ui.notification', { type: 'error', message: `Unable to open file dialog: ${formatTauriError(error)}` });
    });
  };

  return (
    <header className="relative flex h-10 items-end justify-between gap-1.5 border-b border-border/60 bg-card/40 pl-1 pr-3">
      {modes ? (
        <Tabs
          aria-label="Inspector mode"
          idBase={MODE_TABS_ID}
          value={topLevelMode}
          onValueChange={onSelectMode}
          items={modes.map((m) => ({
            value: m.id,
            label: m.title,
            ...(m.tabTitle ? { title: m.tabTitle } : {}),
          }))}
        />
      ) : (
        <span aria-hidden />
      )}
      <Button
        variant="secondary"
        size="sm"
        className="mb-2 self-end"
        onClick={onOpenLoad}
        aria-label="Load"
        title="Load"
        aria-haspopup="menu"
        aria-expanded={loadOpen}
        icon={<span aria-hidden>+</span>}
      >
        Load
      </Button>

      <LoadSheet
        open={loadOpen}
        onClose={onCloseLoad}
        onLoadVolume={openFile}
        onLoadSurface={openFile}
        onLoadAtlas={() => setDialog('atlas')}
        onProjectVolumeToSurface={() => setDialog('projection')}
      />
      {dialog === 'atlas' && <AtlasPicker onClose={() => setDialog(null)} />}
      {dialog === 'projection' && <ProjectionPicker onClose={() => setDialog(null)} />}
    </header>
  );
}

function InspectorBody() {
  const { mode, workspaceType } = useDisplayMode();

  switch (mode) {
    case 'set-studio':
      return <StudioInspectorPanel />;
    case 'bids':
      return <BidsInspector />;
    case 'orthogonal':
    case 'integrated':
    case 'mosaic':
    case 'compare':
    case 'surface':
      return <ImagingInspector />;
    case 'module-tool':
      return <ModuleToolInspector workspaceType={workspaceType} />;
    case 'unknown':
    default:
      return (
        <div className="px-3 py-6 text-center text-bf-sm text-muted-foreground">
          No active workspace.
        </div>
      );
  }
}

/** The Inspector body a module tool declares (lazy), or a neutral notice. */
function ModuleToolInspector({ workspaceType }: { workspaceType: string | null }) {
  const tool = moduleRegistry.getModuleTool(workspaceType);
  if (!tool?.inspector) {
    return (
      <div className="px-3 py-6 text-center text-bf-sm text-muted-foreground">
        Nothing to inspect here.
      </div>
    );
  }
  const Body = lazyComponent(tool.inspector);
  return (
    <ActiveModuleGate moduleId={tool.moduleId} label={tool.label}>
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </ActiveModuleGate>
  );
}

function AnnotateBody() {
  return (
    <div className="px-3 py-6 text-center text-bf-sm text-muted-foreground">
      Annotate mode is not yet enabled in this Inspector shell.
    </div>
  );
}

function InspectorFooter() {
  const totalCount = useSceneStack().totalCount;
  const activeId = useInspectorSelectionStore((state) => state.activeItemId);

  return (
    <footer className="flex items-center justify-between border-t border-border bg-card/40 px-3 py-1.5 text-bf-xs text-muted-foreground">
      <span
        className="tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {totalCount} scene item{totalCount === 1 ? '' : 's'}
      </span>
      <span
        className={
          activeId
            ? 'tabular-nums text-primary'
            : 'tabular-nums text-muted-foreground'
        }
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {activeId ? '1 selected' : 'none selected'}
      </span>
    </footer>
  );
}
