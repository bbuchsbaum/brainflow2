/** Dev-only visual fixture: real folder menu, checklist, lifecycle, stores and selector; mocked I/O. */
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OpenImageSetDialog } from '@/components/dialogs/OpenImageSetDialog';
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { SceneStack } from '@/components/inspector/imaging/SceneStack';
import { ImageSetSection } from '@/components/inspector/imaging/sections/ImageSetSection';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { useSceneStack } from '@/hooks/useSceneStack';
import { getApiService } from '@/services/apiService';
import { initializeLayerService } from '@/services/LayerService';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { histogramService } from '@/services/HistogramService';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useImageSetStore } from '@/stores/imageSetStore';
import { useLayerStore } from '@/stores/layerStore';
import { setTransport } from '@/services/transport';
import '@/index.css';

const folder = '/fixture/one_sample_all';
const names = [
  'beta_intercept',
  'df_res',
  'p_intercept',
  'se_intercept',
  'sigma2',
  'z_intercept',
].map((suffix) => `one_sample_all_${suffix}.nii.gz`);
const nodes = names.map((name) => ({
  id: `${folder}/${name}`,
  name,
  isDir: false,
  parentIdx: null,
  iconId: 0,
}));
setTransport({ invoke: async () => false } as never);
useWorkspaceStore.setState({
  activeWorkspaceId: 'fixture',
  workspaces: new Map([
    [
      'fixture',
      {
        id: 'fixture',
        type: 'integrated',
        title: 'Integrated',
        timestamp: Date.now(),
        isActive: true,
        layoutConfig: { root: { type: 'row', content: [] } },
        panelStates: new Map(),
      },
    ],
  ]),
});
useFileBrowserStore.setState({
  currentPath: folder,
  rootPath: folder,
  selectedPath: folder,
  loading: false,
  error: null,
  viewMode: 'tree',
  entries: [
    {
      id: folder,
      path: folder,
      name: 'one_sample_all',
      type: 'directory',
      depth: 0,
      expanded: true,
      children: nodes.map((node) => ({
        id: node.id,
        path: node.id,
        name: node.name,
        type: 'file',
        depth: 1,
      })),
    },
  ],
});
const api = getApiService();
api.listDirectory = async () => nodes;
let serial = 0;
api.loadFile = async (path) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return {
    id: `fixture-${++serial}`,
    name: path.split('/').pop()!,
    dims: [97, 115, 97],
    dtype: 'f32',
    volume_type: 'Volume3D',
  };
};
api.getVolumeBounds = async () =>
  ({ min: [-96, -132, -78], max: [96, 96, 114], center: [0, -18, 18] }) as never;
api.getInitialViews = async () => structuredClone(useViewStateStore.getState().viewState.views);
api.requestLayerGpuResources = async () =>
  ({
    data_range: { min: -4, max: 6 },
    dim: [97, 115, 97],
    spacing: [2, 2, 2],
    center_world: [0, -18, 18],
  }) as never;
api.waitForLayerReady = async () => true;
api.releaseLayerGpuResources = async () => undefined as never;
api.unloadVolume = async () => undefined as never;
histogramService.computeHistogram = async () =>
  ({ bins: [], totalCount: 0, mean: 0, min: -4, max: 6 }) as never;
initializeLayerService(new LayerApiImpl());

function Harness() {
  const stack = useSceneStack();
  const active = stack.volumes[0];
  const sets = useImageSetStore((state) => state.sets);
  const layers = useLayerStore((state) => state.layers);
  const entry = Object.values(sets)[0];
  return (
    <main className="grid h-screen grid-cols-[330px_minmax(0,1fr)_360px] bg-background text-foreground">
      <aside className="min-h-0 border-r border-border">
        <FileBrowserPanel />
      </aside>
      <div className="space-y-4 p-8 text-sm">
        <h1 className="font-semibold">Folder image-set UI check</h1>
        <p className="text-muted-foreground">
          Use the folder context menu or Files actions to open the checklist.
        </p>
        <p className="text-xs text-muted-foreground">
          Backend I/O is mocked in this development fixture.
        </p>
        <output data-testid="layer-count">Scene layers: {layers.length}</output>
        <p data-testid="current-image" className="break-all font-mono">
          {entry?.members[entry.activeIndex]?.name ?? 'No image selected'}
        </p>
      </div>
      <aside className="border-l border-border">
        <SceneStack />
        {active && <ImageSetSection item={active} />}
      </aside>
      <OpenImageSetDialog />
      <ContextMenu />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
