/**
 * Scenario drivers for the full-app harness. Each scenario uses the app's real
 * services where feasible; any direct store seeding is recorded via
 * `noteFallback` so reviewers can see where the harness departs from the app.
 */
import type { HarnessBackend } from './backend';
import { BIDS_ROOT, REMOTE_MOUNT_DEMO } from './scenarioData';
import {
  ATLAS_PATH,
  HARNESS_ROOT,
  MNI_PATH,
  STATS_PATH,
  SURFACE_OVERLAY_PATH,
  SURFACE_PATH,
  TMAP_PATH,
  ZMAP_PATH,
} from './backend';
import p3Meta from '../fixtures/app/p3_fixtures.json';
import type { HarnessFixtures } from './fixtures';
import { noteStep } from './harnessLog';
import { frames, until } from './readiness';

export interface ScenarioContext {
  backend: HarnessBackend;
  fixtures: HarnessFixtures;
}

let backendRef: HarnessBackend | null = null;
function activeBackend(): HarnessBackend {
  if (!backendRef) throw new Error('harness backend not set');
  return backendRef;
}

async function servicesReady(): Promise<void> {
  const { areServicesInitialized } = await import('@/hooks/useServicesInit');
  await until(() => areServicesInitialized(), 'services initialized');
}

async function loadVolume(path: string, intent: 'default' | 'add-layer' = 'default'): Promise<void> {
  const { getFileLoadingService } = await import('@/services/FileLoadingService');
  await getFileLoadingService().loadFile(path, 'programmatic', intent);
  noteStep(`loaded ${path}`);
}

/** Mount the virtual study folder through the same store action the mount-event listener uses. */
async function mountStudy(
  expand: string[] = ['anat'],
  root = HARNESS_ROOT,
  label = 'study',
): Promise<void> {
  const { useFileBrowserStore } = await import('@/stores/fileBrowserStore');
  await useFileBrowserStore.getState().mountDirectory(root, { displayName: label });
  noteStep(`mounted ${root}`);
  // The tree (react-arborist) owns its open state; expand rows the way a user does.
  for (const name of [label, ...expand]) {
    await clickTreeRow(name);
  }
}

async function clickTreeRow(name: string): Promise<void> {
  const find = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.react-arborist [role="treeitem"]')).find(
      (el) =>
        (el.querySelector<HTMLElement>('[data-full-name]')?.dataset.fullName ?? el.textContent?.trim())?.startsWith(
          name,
        ),
    ) ?? null;
  await until(() => find() !== null, `file tree row '${name}'`);
  const row = find()!;
  const target = (row.firstElementChild as HTMLElement | null) ?? row;
  target.click();
  await frames(3);
  noteStep(`clicked tree row ${name}`);
}

async function layerIdForPath(path: string): Promise<string> {
  const { useLayerStore } = await import('@/stores/layerStore');
  const volumeIds = [...activeBackend().volumes.values()]
    .filter((v) => v.path === path)
    .map((v) => v.id);
  const layer = useLayerStore.getState().layers.find((l) => volumeIds.includes(l.volumeId));
  if (!layer) throw new Error(`no layer for ${path}`);
  return layer.id;
}

/**
 * Select a volume layer the way a SceneStack row click does: the Inspector
 * follows `inspectorSelectionStore`, which mirrors into `layerStore`.
 */
/**
 * Several loads finish in any order, so their "Loaded …" toasts stack (and
 * get painted) differently run to run: once every backend call has settled,
 * dismiss them. Toast placement stays covered by the single-load specimens
 * (e.g. volume), whose one toast is deterministic.
 */
async function dismissLoadToasts(): Promise<void> {
  await until(() => window.__harnessLog.pending === 0, 'backend calls settled');
  const { getEventBus } = await import('@/events/EventBus');
  getEventBus().emit('ui.notification.clear', {});
  await frames(2);
}

/** Accessible name of an element: aria-labelledby texts, else aria-label, else its text. */
function accessibleName(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
  }
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
}

async function selectLayer(path: string): Promise<string> {
  const { useLayerStore } = await import('@/stores/layerStore');
  const { useInspectorSelectionStore } = await import('@/stores/inspectorSelectionStore');
  const { buildSceneStack } = await import('@/hooks/useSceneStack');
  const id = await layerIdForPath(path);
  const stack = buildSceneStack(useLayerStore.getState().layers, new Map(), null);
  const item = stack.volumes.find((v) => v.ref.type === 'volume' && v.ref.layerId === id);
  if (!item) throw new Error(`no scene item for layer ${id}`);
  useInspectorSelectionStore.getState().setActive(item);
  noteStep(`selected scene item for layer ${id}`);
  return id;
}

/** Plain keydown on window, as KeyboardShortcutService listens (no focus in inputs). */
async function pressKey(key: string, modifiers: { meta?: boolean; shift?: boolean } = {}): Promise<void> {
  (document.activeElement as HTMLElement | null)?.blur?.();
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      metaKey: !!modifiers.meta,
      shiftKey: !!modifiers.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
  await frames(3);
  noteStep(`pressed ${modifiers.meta ? 'Meta+' : ''}${key}`);
}

/** Move the crosshair through the canonical workspace navigation path (as AtlasRoiService does). */
async function navigateTo(world: [number, number, number]): Promise<void> {
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  const state = useViewStateStore.getState();
  await state.setCrosshair(world, true, true, state.activeWorkspaceKey);
  noteStep(`crosshair -> ${world.join(',')}`);
}

/** Click an element (button, GoldenLayout tab, ...) whose trimmed text matches exactly. */
async function clickByText(selector: string, text: string): Promise<void> {
  const find = () =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (el) => el.textContent?.trim() === text,
    ) ?? null;
  await until(() => find() !== null, `${selector} '${text}'`);
  find()!.click();
  await frames(3);
  noteStep(`clicked ${selector} '${text}'`);
}

/**
 * Keyboard entry by Tab: a trusted Tab keydown's default action moves focus to
 * the next tabbable element. Untrusted (dispatched) events have no default
 * action, so the harness dispatches the keydown (which the app's listeners see,
 * e.g. useKeyboardNavWithin's Tab detection) and then performs the focus move
 * itself, followed by the matching keyup.
 */
async function tabInto(target: HTMLElement, label: string): Promise<void> {
  const from = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true, composed: true };
  from.dispatchEvent(new KeyboardEvent('keydown', init));
  target.focus({ focusVisible: true } as FocusOptions);
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', init));
  await frames(3);
  noteStep(`Tab -> ${label}`);
}

/** Key press delivered to the focused element (bubbling, as a real key event does). */
async function pressFocused(key: string): Promise<void> {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key, code: key, bubbles: true, cancelable: true, composed: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  await frames(3);
  noteStep(`pressed ${key} on focused element`);
}

function focusedTreeRowText(): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active.getAttribute('role') !== 'treeitem') return null;
  // Rows render a middle-truncated name (formatName); the full name is on
  // the name element's data-full-name.
  const full = active.querySelector<HTMLElement>('[data-full-name]')?.dataset.fullName;
  return full ?? active.textContent?.trim() ?? null;
}

/** Keyboard navigation into the Files tree: Tab into it, then arrow down to `rowName`. */
async function keyboardIntoTree(rowName: string): Promise<void> {
  const tree = document.querySelector<HTMLElement>('.fb-tree-container [role="tree"]');
  if (!tree) throw new Error('files tree not found');
  await tabInto(tree, 'files tree');
  await until(() => focusedTreeRowText() !== null, 'tree row focused after Tab');
  noteStep(`tree focus on '${focusedTreeRowText()}'`);
  for (let i = 0; i < 8 && !focusedTreeRowText()?.includes(rowName); i++) {
    await pressFocused('ArrowDown');
    noteStep(`tree focus on '${focusedTreeRowText()}'`);
  }
  await until(() => !!focusedTreeRowText()?.includes(rowName), `tree row '${rowName}' focused`);
  await until(
    () => document.querySelector('.fb-tree-container')?.getAttribute('data-kbd-nav') === 'true',
    'tree keyboard-nav mark',
  );
}

/** Click the first element matching `selector` that `predicate` accepts (waits for it). */
async function clickWhere(
  selector: string,
  predicate: (el: HTMLElement) => boolean,
  label: string,
): Promise<HTMLElement> {
  const find = () => Array.from(document.querySelectorAll<HTMLElement>(selector)).find(predicate) ?? null;
  await until(() => find() !== null, label);
  const el = find()!;
  el.click();
  await frames(3);
  noteStep(`clicked ${label}`);
  return el;
}

/** The form control named by a `<label for>` whose text is `text`, inside `root`. */
function controlByLabel<T extends HTMLElement>(root: ParentNode, text: string): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find(
    (l) => l.textContent?.trim() === text,
  );
  return label?.htmlFor ? (document.getElementById(label.htmlFor) as T | null) : null;
}

/**
 * Type into a React-controlled input the way the browser reports it: focus,
 * set the value through the native setter (so React's value tracker sees a
 * change), then dispatch a bubbling `input` event.
 */
async function typeInto(root: ParentNode, labelText: string, value: string): Promise<void> {
  await until(() => !!controlByLabel(root, labelText), `field '${labelText}'`);
  const input = controlByLabel<HTMLInputElement>(root, labelText)!;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await frames(2);
  noteStep(`typed '${value}' into ${labelText}`);
}

/** Choose an option of a native `<select>` (focus, set value, bubbling `change`). */
async function chooseOption(root: ParentNode, labelText: string, value: string): Promise<void> {
  await until(() => !!controlByLabel(root, labelText), `select '${labelText}'`);
  const select = controlByLabel<HTMLSelectElement>(root, labelText)!;
  select.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await frames(2);
  noteStep(`chose '${value}' in ${labelText}`);
}

async function baseVolume(): Promise<void> {
  await servicesReady();
  await mountStudy();
  await loadVolume(MNI_PATH);
}

async function loadOverlay(): Promise<string> {
  await loadVolume(STATS_PATH, 'add-layer');
  const id = await layerIdForPath(STATS_PATH);
  // Same write the Inspector's RenderSection performs (setLayerField -> setViewState).
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  useViewStateStore.getState().setViewState((draft) => {
    const target = draft.layers.find((l) => l.id === id);
    if (!target) return;
    target.intensity = [-6, 6];
    target.threshold = [-2.3, 2.3];
    target.opacity = 0.9;
  });
  noteStep('overlay window/threshold set like RenderSection.setLayerField');
  return id;
}

// ---------------------------------------------------------------------------
// Phase 3 scenarios (.hillclimb/p3). Not part of the screenshot gate: the e2e
// lists them separately (P3_SCENARIOS) so the gate baselines stay untouched.
// ---------------------------------------------------------------------------

/** Peak of the positive z blob (mm), on the axial plane z = 50. */
const Z_PEAK: [number, number, number] = [-40, -20, 50];
/** Inside atlas region 2 (R occipitotemporal) and the second z blob. */
const REGION_2 = p3Meta.region_at_crosshair.world_mm as [number, number, number];

/** T1 + one statistic overlay, window/threshold set the way RenderSection writes them. */
async function loadStat(
  path: string,
  window: [number, number],
  threshold: [number, number],
): Promise<string> {
  await loadVolume(path, 'add-layer');
  const id = await layerIdForPath(path);
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  useViewStateStore.getState().setViewState((draft) => {
    const target = draft.layers.find((l) => l.id === id);
    if (!target) return;
    target.intensity = window;
    target.threshold = threshold;
    target.opacity = 0.9;
  });
  noteStep(`stat overlay ${path}: window ${window.join('..')}, threshold ${threshold.join('..')}`);
  return id;
}

async function p3Base(expand: string[] = ['anat', 'stats']): Promise<void> {
  await servicesReady();
  await mountStudy(expand);
  await loadVolume(MNI_PATH);
}

const loadZ = () => loadStat(ZMAP_PATH, [-6, 6], [-3.1, 3.1]);

/** Open the bottom dock on the plot tab (what the Inspector's "open in dock" does). */
async function openPlotDock(mode: 'histogram' | null): Promise<void> {
  const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
  const { usePlotModeStore } = await import('@/stores/plotModeStore');
  useLayoutSettingsStore.getState().setBottomDockOpen(true);
  useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
  useLayoutSettingsStore.getState().setBottomDockHeight(320);
  if (mode) usePlotModeStore.getState().setActivePlotMode(mode);
  noteStep(`bottom dock: plot tab, 320 px${mode ? `, ${mode} mode` : ''}`);
}

/**
 * Client point of a world coordinate on a slice canvas: view-plane pixel
 * (origin/u/v), then the canvas fit (calculateImagePlacement), then CSS pixels.
 */
async function clientPointOf(
  view: 'axial' | 'sagittal' | 'coronal',
  world: [number, number, number],
): Promise<{ x: number; y: number; canvas: HTMLCanvasElement }> {
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  const { calculateImagePlacement } = await import('@/utils/canvasUtils');
  const plane = useViewStateStore.getState().viewState.views[view];
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-view-id="${view}"] canvas`);
  if (!plane || !canvas) throw new Error(`no ${view} view/canvas`);
  const o = plane.origin_mm;
  const u = plane.u_mm;
  const v = plane.v_mm;
  const d = [world[0] - o[0], world[1] - o[1], world[2] - o[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const px = dot(d, u) / dot(u, u);
  const py = dot(d, v) / dot(v, v);
  const [iw, ih] = plane.dim_px;
  const fit = calculateImagePlacement(iw, ih, canvas.width, canvas.height);
  const bx = fit.x + (px / iw) * fit.width;
  const by = fit.y + (py / ih) * fit.height;
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + (bx * rect.width) / canvas.width,
    y: rect.top + (by * rect.height) / canvas.height,
    canvas,
  };
}

/** Pointer hover over a world point of a slice view (the events useHoverInfo listens to). */
async function hoverWorld(view: 'axial' | 'sagittal' | 'coronal', world: [number, number, number]) {
  const exact = await clientPointOf(view, world);
  // A synthetic MouseEvent truncates clientX/Y to whole CSS pixels (as real
  // mouse events report them), so dispatch at the nearest whole pixel; the
  // app reads exactly that pixel (v2 fidelity: the 0.6 mm "offset" was the
  // dropped fraction, not the app's placement).
  const { canvas } = exact;
  const x = Math.round(exact.x);
  const y = Math.round(exact.y);
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, view: window };
  canvas.dispatchEvent(new PointerEvent('pointerover', init));
  canvas.dispatchEvent(new MouseEvent('mouseover', init));
  canvas.dispatchEvent(new PointerEvent('pointermove', init));
  canvas.dispatchEvent(new MouseEvent('mousemove', init));
  await frames(3);
  noteStep(`hover ${view} at ${world.join(',')} (client ${x.toFixed(1)},${y.toFixed(1)})`);
}

async function enterDisplayMode(label: 'Compare' | 'Mosaic'): Promise<void> {
  await clickByText('[data-testid="display-mode-selector"] button', label);
}

/** The export dialog has composed (and shows) its current options. */
async function exportSettled(): Promise<void> {
  const { useExportDialogStore } = await import('@/stores/exportDialogStore');
  await frames(2);
  await until(() => {
    const state = useExportDialogStore.getState();
    return !state.isCapturing && (state.imageUrl !== null || state.error !== null);
  }, 'export composition settled');
  const error = useExportDialogStore.getState().error;
  if (error) throw new Error(`export failed: ${error}`);
  await until(
    () => (document.querySelector<HTMLImageElement>('img[alt="Captured view preview"]')?.complete ?? false),
    'export preview image loaded',
  );
  await frames(3);
}

const P3_DRIVERS: Record<string, (ctx: ScenarioContext) => Promise<void>> = {
  // P3.3: z statistic with intent metadata (header: intent 5, "z-score").
  'stat-overlay-z': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    await selectLayer(ZMAP_PATH);
  },
  // P3.3: t statistic, intent 3 with df = 24 in intent_p1.
  'stat-overlay-t': async () => {
    await p3Base();
    await loadStat(TMAP_PATH, [-7, 7], [-3.5, 3.5]);
    await navigateTo(Z_PEAK);
    await selectLayer(TMAP_PATH);
  },
  // P3.3: image header dialog for the z map (description and intent).
  'header-stat': async () => {
    await p3Base();
    await loadZ();
    await selectLayer(ZMAP_PATH);
    await pressKey('i', { meta: true });
    await until(() => !!document.querySelector('[role="dialog"]'), 'image header dialog');
  },
  // P3.4: user-loaded label volume with a TSV LUT sidecar; crosshair in region 2.
  // P3.4 + v1 critics: the label map above a statistic (t map), so the
  // label layer's default display (outline) is judged at 1600 and 1280.
  'region-at-crosshair': async () => {
    await p3Base();
    await loadStat(TMAP_PATH, [-7, 7], [-3.5, 3.5]);
    await loadVolume(ATLAS_PATH, 'add-layer');
    await navigateTo(REGION_2);
    await selectLayer(ATLAS_PATH);
  },
  // P3.2: even-dimension volume (96x114x96) at the default (centre) crosshair.
  'voxel-nav': async () => {
    await p3Base(['anat']);
    await selectLayer(MNI_PATH);
  },
  // P3.13: Go-to dialog in voxel mode, crosshair at a known voxel (69, 36, 34).
  'goto-voxel': async () => {
    await p3Base(['anat']);
    await navigateTo(REGION_2);
    await pressKey('g');
    await until(() => !!document.querySelector('[role="dialog"]'), 'go-to dialog');
    await clickWhere(
      '[role="dialog"] [role="radio"]',
      (el) => el.textContent?.trim() === 'Voxel',
      "coordinate space 'Voxel'",
    );
  },
  // P3.5: the Clusters dock tab, opened through the panel-menu event (View >
  // Panels > Clusters), computed at the z map's display threshold (|z| > 3.1,
  // 26-connected) with row 1 selected (crosshair at its peak).
  'cluster-table': async () => {
    await p3Base();
    await loadZ();
    // The atlas names the region at each peak (Region column) but stays
    // hidden, so the viewports show the z map only.
    await loadVolume(ATLAS_PATH, 'add-layer');
    const atlasId = await layerIdForPath(ATLAS_PATH);
    const { useViewStateStore } = await import('@/stores/viewStateStore');
    useViewStateStore.getState().setViewState((state) => {
      const atlas = state.layers.find((l) => l.id === atlasId);
      if (atlas) {
        atlas.visible = false;
        atlas.opacity = 0;
      }
    });
    noteStep('atlas loaded and hidden (region lookup only)');
    await selectLayer(ZMAP_PATH);
    window.dispatchEvent(
      new CustomEvent('golden-layout-add-panel', { detail: { panelType: 'ClusterPanel' } }),
    );
    await until(() => !!document.querySelector('[data-testid="cluster-panel"]'), 'Clusters dock tab');
    await clickWhere(
      '[data-testid="cluster-panel"] button',
      (el) => el.textContent?.trim() === 'Compute',
      'Compute',
    );
    await until(() => !!document.querySelector('[data-testid="cluster-row-1"]'), 'cluster rows');
    (document.querySelector('[data-testid="cluster-row-1"]') as HTMLElement).click();
    const { useClusterStore } = await import('@/stores/clusterStore');
    await until(() => useClusterStore.getState().selectedId === 1, 'cluster row 1 selected');
    noteStep(
      `clusters: ${document.querySelector('[data-testid="cluster-layer"]')?.textContent} · ${
        document.querySelector('[data-testid="cluster-methods"]')?.textContent
      }`,
    );
    await frames(5);
  },
  // P3.6: three visible layers, pointer hovering inside the z blob / region 1.
  'multi-layer-readout': async () => {
    await p3Base();
    await loadZ();
    await loadVolume(ATLAS_PATH, 'add-layer');
    await navigateTo(Z_PEAK);
    await selectLayer(ZMAP_PATH);
    await frames(5);
    // Default readout (P3.6): no tooltip; the Inspector's Scene rows read every
    // visible layer at the pointer, and the status Mouse slot shows where.
    // Inside z blob 1 and atlas region 1, at voxel (29, 57, 64) (fidelity
    // critic): T1 167, z 5.43, atlas L_sensorimotor.
    await hoverWorld('axial', [-37.5, -17.5, 50.5]);
    const { useStatusBarStore } = await import('@/stores/statusBarStore');
    await until(
      () => useStatusBarStore.getState().values.mouse !== '--',
      'status mouse slot updated by hover',
    );
    await until(
      () =>
        document
          .querySelector('[data-testid="scene-readout-caption"]')
          ?.textContent?.startsWith('At pointer') === true,
      'scene readout at the pointer',
    );
    await until(
      () =>
        Array.from(document.querySelectorAll('[data-testid^="layer-readout-"]')).every(
          (el) => el.textContent !== '—',
        ),
      'per-layer readout values',
    );
    const readout = Array.from(document.querySelectorAll('[data-testid^="layer-readout-"]')).map(
      (el) => el.textContent ?? '',
    );
    noteStep(`readout: ${readout.join(' | ')}`);
    // Fixture truth at voxel (29, 57, 64): fail loudly if any layer misreads
    // (v1 user critique: the tooltip once reported the T1 for the z map).
    const expected = ['167', 'z 5.43', 'L_sensorimotor'];
    if (readout.join('|') !== expected.join('|')) {
      throw new Error(`multi-layer readout ${JSON.stringify(readout)} != ${JSON.stringify(expected)}`);
    }
  },
  // P3.7: mosaic with the z overlay.
  'mosaic-labelled': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    await enterDisplayMode('Mosaic');
    await until(() => document.querySelectorAll('[data-testid="mosaic-tile-label"]').length > 0, 'mosaic tiles');
    await frames(10);
    // The user's "cramped" check: the share of the pane (minus the colorbar
    // column) the tiles (image + label strip) cover, measured in the DOM.
    const grid = document.querySelector<HTMLElement>('[data-testid="mosaic-tile-grid"]');
    const area = document.querySelector<HTMLElement>('.mosaic-grid');
    const cells = Array.from(document.querySelectorAll<HTMLElement>('.mosaic-cell'));
    if (grid && area) {
      const a = area.getBoundingClientRect();
      const tiles = cells.reduce((sum, c) => {
        const r = c.getBoundingClientRect();
        return sum + r.width * r.height;
      }, 0);
      const column = document.querySelector<HTMLElement>('[data-testid="mosaic-colorbar"]');
      const columnW = column ? column.getBoundingClientRect().width : 112;
      const usable = (a.width - 16 - columnW - 6) * (a.height - 16);
      // The colorbar (caption and footer) must end inside the pane.
      const bar = column?.querySelector<HTMLElement>('[data-testid="viewport-colorbar"]');
      if (bar) {
        let right = 0;
        bar.querySelectorAll<HTMLElement>('*').forEach((c) => {
          right = Math.max(right, c.getBoundingClientRect().right);
        });
        noteStep(`mosaic colorbar right ${right.toFixed(1)} / pane right ${a.right.toFixed(1)}`);
        noteStep(`mosaic area scroll ${area.scrollWidth}x${area.scrollHeight} / client ${area.clientWidth}x${area.clientHeight}`);
        if (right > a.right + 0.5) throw new Error('mosaic colorbar clipped at the pane edge');
      }
      noteStep(
        `mosaic fill: ${(tiles / usable).toFixed(3)} (layout ${grid.dataset.fill}), grid ${
          getComputedStyle(grid).gridTemplateColumns.split(' ').length
        }×${getComputedStyle(grid).gridTemplateRows.split(' ').length}`,
      );
    }
  },
  // P3.1/P3.8: "Export View as Image…" from the axial view's context menu.
  'export-dialog': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    const target = document.querySelector<HTMLElement>('[data-view-id="axial"]');
    if (!target) throw new Error('axial view not found');
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
    await frames(3);
    await clickWhere(
      '[role="menuitem"]',
      (el) => el.textContent?.trim() === 'Export View as Image…',
      "context menu 'Export View as Image…'",
    );
    const { useExportDialogStore } = await import('@/stores/exportDialogStore');
    await until(() => useExportDialogStore.getState().isOpen, 'export dialog store open');
    await until(() => !useExportDialogStore.getState().isCapturing, 'export capture settled');
    // P3.8: "As shown" first, then the "Figure" preset (no crosshair; slice
    // position, letters, colorbar and scale bar on white) at 89 mm, 300 dpi.
    await clickWhere(
      '[role="dialog"] [role="radio"]',
      (el) => el.textContent?.trim() === 'As shown',
      "export preset 'As shown'",
    );
    await exportSettled();
    await clickWhere(
      '[role="dialog"] [role="radio"]',
      (el) => el.textContent?.trim() === 'Figure',
      "export preset 'Figure'",
    );
    await clickWhere('[role="dialog"] [role="radio"]', (el) => el.textContent?.trim() === 'Print', "size 'Print'");
    await exportSettled();
    noteStep(`export: ${document.querySelector('[data-testid="export-size"]')?.textContent}`);
  },
  // P3.8 (v4 user critic): the orthogonal "Figure row" export (axial |
  // coronal | sagittal, one mm/px, cropped to the brain) at 183 mm, 300 dpi.
  'export-orthogonal': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    const { useExportDialogStore } = await import('@/stores/exportDialogStore');
    const store = useExportDialogStore.getState();
    store.applyPreset('figure');
    store.setSize({ kind: 'print', widthMm: 183, dpi: 300 });
    store.open();
    // open() clears the target; the dialog picks its default, then we switch.
    await exportSettled();
    const before = useExportDialogStore.getState().imageUrl;
    useExportDialogStore.getState().setExportTarget('orthogonal-row');
    await until(() => useExportDialogStore.getState().imageUrl !== before, 'figure row composed');
    await exportSettled();
    noteStep(`export: ${document.querySelector('[data-testid="export-size"]')?.textContent}`);
  },
  // P3.8: the mosaic exported as one image (tiles in grid order, one colorbar).
  'export-mosaic': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    await enterDisplayMode('Mosaic');
    await until(
      () => document.querySelectorAll('[data-testid="mosaic-tile-label"]').length > 0,
      'mosaic tiles labelled',
    );
    await frames(10);
    const { useExportDialogStore } = await import('@/stores/exportDialogStore');
    // A slice range (every 3rd slice of the cropped brain) at a two-column
    // print width: tiles in grid order, one colorbar, one scale bar.
    const { currentMosaicExportSource } = await import('@/services/export/compositeCapture');
    const source = currentMosaicExportSource();
    const sampling = source?.sampling;
    if (!sampling) throw new Error('mosaic export source has no sampling');
    const store = useExportDialogStore.getState();
    store.applyPreset('figure');
    store.setSize({ kind: 'print', widthMm: 183, dpi: 300 });
    store.setMosaicTiles({
      kind: 'range',
      fromMm: sampling.min + sampling.first * sampling.step,
      toMm: sampling.min + sampling.last * sampling.step,
      every: 3,
    });
    store.open();
    await exportSettled();
    noteStep(`export: ${document.querySelector('[data-testid="export-size"]')?.textContent}`);
  },
  // P3.8 (v2 function critic): a save that the backend rejects with a plain
  // string shows the reason inline (role=alert) and keeps the dialog open.
  'export-error': async () => {
    await p3Base();
    await loadZ();
    await navigateTo(Z_PEAK);
    activeBackend().setHandler('save_image_bytes', () => {
      throw 'Permission denied: /Volumes/readonly/figure.png';
    });
    const { useExportDialogStore } = await import('@/stores/exportDialogStore');
    useExportDialogStore.getState().open();
    await exportSettled();
    await clickWhere('[role="dialog"] button', (el) => el.textContent?.trim() === 'Save…', "'Save…'");
    await until(() => !!document.querySelector('[data-testid="export-error"]'), 'export error alert');
    noteStep(`export error: ${document.querySelector('[data-testid="export-error"]')?.textContent}`);
    // The rejection was the scenario's own: keep it out of the error check.
    const log = window.__harnessLog;
    const expected = log.errors.filter((e) => e.cmd === 'save_image_bytes');
    log.errors = log.errors.filter((e) => e.cmd !== 'save_image_bytes');
    noteStep(`expected backend rejections: ${expected.length}`);
    await frames(3);
  },
  // P3.9: Compare with the same overlay in both panels (each panel shows T1 + z).
  'compare-linked': async () => {
    await p3Base();
    await loadZ();
    await enterDisplayMode('Compare');
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    await until(
      () => [...useComparisonStore.getState().panels.values()].some((p) => p.length >= 2),
      'two comparison panels',
    );
    const t1 = await layerIdForPath(MNI_PATH);
    const z = await layerIdForPath(ZMAP_PATH);
    const store = useComparisonStore.getState();
    for (const [workspaceId, panels] of store.panels) {
      for (const panel of panels) {
        // The per-panel layer toggles: both panels show T1 under the z map.
        if (!panel.visibleLayerIds.has(t1)) store.addLayerToPanel(workspaceId, panel.id, t1);
        if (!panel.visibleLayerIds.has(z)) store.addLayerToPanel(workspaceId, panel.id, z);
      }
    }
    noteStep('compare panels: T1 + z in each');
    await navigateTo(Z_PEAK);
    // P3.9: unlink the display, make panel B active and give it its own
    // threshold (|z| <= 4.5 hidden; panel A keeps the shared 3.1).
    await clickWhere(
      '[data-testid="compare-link-mode"] [role="radio"]',
      (el) => el.textContent?.trim() === 'Window',
      "Link 'Window'",
    );
    await until(
      () => useComparisonStore.getState().linkModes.get([...useComparisonStore.getState().panels.keys()][0]) === 'window',
      'threshold and colormap per panel',
    );
    const panelB = document.querySelector<HTMLElement>('[data-panel-letter="B"]');
    if (!panelB) throw new Error('compare panel B not found');
    panelB.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await until(() => panelB.dataset.activePanel === 'true', 'panel B active');
    const [workspaceId, panels] = [...useComparisonStore.getState().panels.entries()][0];
    useComparisonStore.getState().setPanelOverride(workspaceId, panels[1].id, z, 'threshold', [-4.5, 4.5]);
    await selectLayer(ZMAP_PATH);
    await until(
      () => !!document.querySelector('[data-testid="override-threshold"]'),
      "Inspector 'Panel B only' threshold mark",
    );
    noteStep(`compare: ${document.querySelector('[data-testid="compare-edit-bar"]')?.textContent}`);
    await frames(10);
  },
  // P3.11: empty workspaces with the next action.
  'empty-compare': async () => {
    await servicesReady();
    await enterDisplayMode('Compare');
  },
  'empty-mosaic': async () => {
    await servicesReady();
    await enterDisplayMode('Mosaic');
  },
  // P3.11: the Clusters tab with nothing loaded.
  'empty-clusters': async () => {
    await servicesReady();
    const { openDockTab } = await import('@/components/layout/openDockTab');
    openDockTab('clusters');
    await until(() => !!document.querySelector('[data-testid="cluster-panel"] [data-testid="empty-pane"]'), 'clusters empty state');
  },
  'empty-plot-dock': async () => {
    await servicesReady();
    await openPlotDock(null);
  },
  // P3.12: plot dock with a real plot (histogram of the z map).
  'plot-dock': async () => {
    await p3Base();
    await loadZ();
    await selectLayer(ZMAP_PATH);
    await openPlotDock('histogram');
  },
  // P3.12: a label map in the plot dock: voxels per region in LUT colours,
  // the crosshair's region marked (not an id histogram).
  'plot-dock-labels': async () => {
    await p3Base();
    await loadVolume(ATLAS_PATH, 'add-layer');
    await navigateTo([-39.5, -19.5, 50.5]);
    await selectLayer(ATLAS_PATH);
    await openPlotDock('histogram');
    await until(() => !!document.querySelector('[data-testid="region-count-bars"]'), 'region count bars');
    await until(
      () => !!document.querySelector('[data-testid="region-count-bars"] [data-at-crosshair="true"]'),
      'crosshair region marked',
    );
    noteStep(
      `regions: ${Array.from(document.querySelectorAll('[data-testid="region-count-bars"] li'))
        .map((li) => li.getAttribute('title'))
        .join(' | ')}`,
    );
  },
  // P3.11: Clusters with only a T1 loaded and a statistical map loaded but
  // not selected: the empty state offers that map.
  'clusters-no-stat': async () => {
    await p3Base();
    await loadZ();
    await selectLayer(MNI_PATH);
    const { openDockTab } = await import('@/components/layout/openDockTab');
    openDockTab('clusters');
    await until(() => !!document.querySelector('[data-testid="cluster-panel"] [data-testid="empty-pane"]'), 'clusters empty state');
    noteStep(`clusters: ${document.querySelector('[data-testid="cluster-panel"] [data-testid="empty-pane"]')?.textContent}`);
  },
  // P3.10: the surface view pane itself (frame, header, info card).
  'surface-frame': async () => {
    await p3Base(['anat']);
    await loadVolume(SURFACE_PATH);
    await loadVolume(SURFACE_OVERLAY_PATH);
    await until(
      () =>
        Array.from(document.querySelectorAll('.lm_tab.lm_active .lm_title')).some(
          (el) => el.textContent?.trim() === 'lh.inflated.gii',
        ),
      'surface view tab active',
    );
    await until(() => !!document.querySelector('.lm_content canvas'), 'surface canvas');
    await frames(10);
  },
  // v4 user critic: each camera preset must give its named view.
  'surface-preset-lateral': async (ctx) => {
    await P3_DRIVERS['surface-frame'](ctx);
    await clickWhere(
      '[data-testid="surface-camera-presets"] [role="radio"], [data-testid="surface-camera-presets"] button',
      (el) => el.textContent?.trim() === 'Lateral',
      "surface preset 'Lateral'",
    );
    await frames(20);
  },
  // v4 user critic: each camera preset must give its named view.
  'surface-preset-medial': async (ctx) => {
    await P3_DRIVERS['surface-frame'](ctx);
    await clickWhere(
      '[data-testid="surface-camera-presets"] [role="radio"], [data-testid="surface-camera-presets"] button',
      (el) => el.textContent?.trim() === 'Medial',
      "surface preset 'Medial'",
    );
    await frames(20);
  },
  // v4 user critic: each camera preset must give its named view.
  'surface-preset-dorsal': async (ctx) => {
    await P3_DRIVERS['surface-frame'](ctx);
    await clickWhere(
      '[data-testid="surface-camera-presets"] [role="radio"], [data-testid="surface-camera-presets"] button',
      (el) => el.textContent?.trim() === 'Dorsal',
      "surface preset 'Dorsal'",
    );
    await frames(20);
  },
  // v4 user critic: each camera preset must give its named view.
  'surface-preset-anterior': async (ctx) => {
    await P3_DRIVERS['surface-frame'](ctx);
    await clickWhere(
      '[data-testid="surface-camera-presets"] [role="radio"], [data-testid="surface-camera-presets"] button',
      (el) => el.textContent?.trim() === 'Anterior',
      "surface preset 'Anterior'",
    );
    await frames(20);
  },
  // v4 fidelity critic: the live crosshair must not run through the
  // orientation letters (it bisected "P", which read as "R"). Fails when any
  // crosshair-green pixel lies under a letter of the axial view.
  'crosshair-letter-knockout': async () => {
    await DRIVERS['overlay-colorbar']({} as never);
    await frames(10);
    const view = document.querySelector<HTMLElement>('[data-view-id="axial"]')!;
    const canvases = Array.from(view.querySelectorAll('canvas'));
    const letters = Array.from(view.querySelectorAll<HTMLElement>('span.absolute.font-mono')).filter((e) => /^[APLRSI]$/.test(e.textContent ?? ''));
    for (const c of canvases) {
      const r = c.getBoundingClientRect();
      noteStep(`canvas ${c.width}x${c.height} at ${r.left.toFixed(1)},${r.top.toFixed(1)} css ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      const ctx = c.getContext('2d');
      for (const l of letters) {
        const lr = l.getBoundingClientRect();
        if (!ctx) continue;
        const sx = c.width / r.width, sy = c.height / r.height;
        const x0 = Math.round((lr.left - r.left) * sx), y0 = Math.round((lr.top - r.top) * sy);
        const w = Math.max(1, Math.round(lr.width * sx)), h = Math.max(1, Math.round(lr.height * sy));
        let green = 0;
        try {
          const d = ctx.getImageData(x0, y0, w, h).data;
          for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 120) green += 1;
        } catch { /* */ }
        noteStep(`letter ${l.textContent} rect ${lr.left.toFixed(1)},${lr.top.toFixed(1)} ${lr.width.toFixed(1)}x${lr.height.toFixed(1)} green px in canvas box: ${green}`);
        if (green > 0) throw new Error(`crosshair drawn under the orientation letter ${l.textContent}`);
      }
    }
  },
  // P3.13: Files tree with every folder expanded (captured at 1280x800 only).
  files: async () => {
    await p3Base(['anat', 'stats', 'surf']);
  },
};

const DRIVERS: Record<string, (ctx: ScenarioContext) => Promise<void>> = {
  empty: async () => {
    await servicesReady();
  },
  volume: baseVolume,
  'volume-surface': async () => {
    await baseVolume();
    await loadVolume(SURFACE_PATH);
    await loadVolume(SURFACE_OVERLAY_PATH);
    // ensureSurfaceView adds + activates the surface tab inside a rAF; wait for it
    // so the tab switch below cannot race it.
    await until(
      () =>
        Array.from(document.querySelectorAll('.lm_tab.lm_active .lm_title')).some(
          (el) => el.textContent?.trim() === 'lh.inflated.gii',
        ),
      'surface view tab active',
    );
    await until(() => !!document.querySelector('.lm_content canvas'), 'surface canvas');
    await frames(10);
    // Back to the volume workspace tab, then the top-bar "Integrated" display mode.
    await clickByText('.lm_tab .lm_title', 'Orthogonal');
    await clickByText('button', 'Integrated');
    await until(
      () =>
        Array.from(document.querySelectorAll('.lm_tab.lm_active .lm_title')).some(
          (el) => el.textContent?.trim() === 'Integrated',
        ),
      'integrated workspace tab active',
    );
    await dismissLoadToasts();
  },
  mosaic: async () => {
    await baseVolume();
    await clickByText('button', 'Mosaic');
  },
  plots: async () => {
    await baseVolume();
    await selectLayer(MNI_PATH);
    const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
    const { usePlotModeStore } = await import('@/stores/plotModeStore');
    // What the Inspector's "open in dock" + dock resize handle do.
    useLayoutSettingsStore.getState().setBottomDockOpen(true);
    useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
    useLayoutSettingsStore.getState().setBottomDockHeight(320);
    usePlotModeStore.getState().setActivePlotMode('histogram');
    noteStep('bottom dock: plot tab, 320 px, histogram mode');
  },
  analysis: async () => {
    await baseVolume();
    await selectLayer(MNI_PATH);
    const { getAnalysisWorkbenchService } = await import('@/services/analysis/AnalysisWorkbenchService');
    const { useAnalysisStore } = await import('@/stores/analysisStore');
    await getAnalysisWorkbenchService().openWorkspace();
    await until(() => useAnalysisStore.getState().descriptors.length > 0, 'analyses listed');
    useAnalysisStore.getState().selectAnalysis('smooth-gaussian-sidecar');
    await clickByText('button', 'Run Analysis');
    await until(() => useAnalysisStore.getState().jobs.length > 0, 'analysis job recorded');
    noteStep('analysis workbench: ran smoothing job via Run button');
  },
  bids: async () => {
    await servicesReady();
    await mountStudy([], BIDS_ROOT, 'ds-motor');
    const { useWorkspaceStore } = await import('@/stores/workspaceStore');
    const { useBidsStore } = await import('@/stores/bidsStore');
    // Same pair of calls as the Files rail's "Open in workspace" action.
    await useWorkspaceStore.getState().createWorkspace('bids-explorer');
    await useBidsStore.getState().scanDataset(BIDS_ROOT);
    noteStep('BIDS explorer opened and dataset scanned');
  },
  studio: async () => {
    await servicesReady();
    await mountStudy();
    const { getSetStudioService } = await import('@/services/studio/SetStudioService');
    await getSetStudioService().openDemoInStudio();
    noteStep('Set studio demo session opened');
  },
  'dialog-goto': async () => {
    await baseVolume();
    await pressKey('g');
    await until(() => !!document.querySelector('[role="dialog"]'), 'go-to dialog');
  },
  'dialog-header': async () => {
    await baseVolume();
    await selectLayer(MNI_PATH);
    await pressKey('i', { meta: true });
    await until(() => !!document.querySelector('[role="dialog"]'), 'image header dialog');
  },
  'dialog-crosshair': async () => {
    await baseVolume();
    window.dispatchEvent(new CustomEvent('open-crosshair-settings'));
    await frames(3);
    noteStep('dispatched open-crosshair-settings');
  },
  'inspector-layer': async () => {
    await baseVolume();
    await selectLayer(MNI_PATH);
  },
  overlay: async () => {
    await baseVolume();
    await loadOverlay();
    await navigateTo([-38, -22, 56]);
    await selectLayer(STATS_PATH);
  },
  'overlay-colorbar': async () => {
    await baseVolume();
    await loadOverlay();
    // Medial frontal deactivation (negative blob); the axial plane at z=6 also
    // cuts the positive visual-cortex blobs, so both signs are on screen.
    await navigateTo([0, 48, 6]);
    await selectLayer(STATS_PATH);
  },
  compare: async () => {
    await baseVolume();
    await loadOverlay();
    // Top-bar display-mode switcher, as a user clicks it. ComparisonWorkspace
    // auto-creates one panel per visible layer (MNI, zstat).
    await clickByText('[data-testid="display-mode-selector"] button', 'Compare');
    await until(
      () =>
        document.querySelector('[data-testid="display-mode-selector"]')?.getAttribute('data-active-mode') ===
        'compare',
      'compare mode active',
    );
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    await until(
      () => [...useComparisonStore.getState().panels.values()].some((p) => p.length >= 2),
      'two comparison panels',
    );
    // Axial plane through the bilateral motor blobs, so the zstat panel is not empty.
    await navigateTo([-38, -22, 52]);
  },
  'keyboard-focus': async () => {
    await baseVolume();
    await keyboardIntoTree('MNI152_T1_2mm_brain_mask.nii.gz');
  },
  'keyboard-focus-switcher': async () => {
    await baseVolume();
    // Tab onto the top-bar workspace switcher: a bf SegmentedControl (radio
    // group), whose single Tab stop is the checked segment.
    const active = document.querySelector<HTMLElement>(
      '[data-testid="display-mode-selector"] [role="radio"][aria-checked="true"]',
    );
    if (!active) throw new Error('active display-mode segment not found');
    await tabInto(active, `display mode '${active.textContent?.trim()}'`);
    await until(() => document.activeElement === active, 'switcher segment focused');
  },
  'surface-settings': async (ctx) => {
    await DRIVERS['volume-surface'](ctx);
    // Inspector scene stack: click the surface geometry row like a user.
    await clickWhere(
      '[role="row"]',
      // The row's accessible name ("<layer>, <kind>, <value>", from
      // aria-labelledby), as assistive tech and a user read it.
      (el) => accessibleName(el).startsWith('lh.inflated.gii '),
      "scene row 'lh.inflated.gii'",
    );

    await clickByText('button', 'Surface settings…');
    const popover = () => document.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]');
    await until(() => !!popover(), 'surface settings popover');
    // Expand the collapsed Appearance section inside the popover.
    await clickWhere(
      '[data-radix-popper-content-wrapper] button[aria-expanded="false"]',
      (el) => el.textContent?.trim() === 'Appearance',
      "popover section 'Appearance'",
    );
    await until(
      () =>
        Array.from(popover()?.querySelectorAll('button[aria-expanded="true"]') ?? []).some(
          (b) => b.textContent?.trim() === 'Appearance',
        ),
      'Appearance expanded',
    );
  },
  'dialog-remote-mount': async () => {
    await servicesReady();
    // Files panel start state: the "Mount remote (SSH)…" command.
    await clickWhere(
      'button',
      (el) => el.textContent?.trim() === 'Mount remote (SSH)…',
      "Files command 'Mount remote (SSH)…'",
    );
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    await until(() => !!dialog() && !!controlByLabel(dialog()!, 'Host'), 'remote mount dialog');
    // Profiles load asynchronously and reset the form; the profile select is
    // disabled until they arrive (none saved, so it stays on "New connection…").
    await until(() => {
      const select = controlByLabel<HTMLSelectElement>(dialog()!, 'Saved profile');
      return !!select && !select.disabled && select.value === '';
    }, 'profiles loaded (none saved)');
    await frames(3);
    await typeInto(dialog()!, 'Host', REMOTE_MOUNT_DEMO.host);
    await typeInto(dialog()!, 'User', REMOTE_MOUNT_DEMO.user);
    await typeInto(dialog()!, 'Remote folder', REMOTE_MOUNT_DEMO.remotePath);
    await chooseOption(dialog()!, 'Auth method', 'password');
    await until(() => !!controlByLabel(dialog()!, 'Password'), 'password field shown');
  },
  // Same driver as volume-surface; captured only as the 1280x800 variant (integrated-1280).
  // v5 critics: at 1280 the surface frame's header and camera presets must
  // not overlap (one width budget); fails the capture if their boxes meet.
  integrated: async (ctx) => {
    await DRIVERS['volume-surface'](ctx);
    await until(() => !!document.querySelector('[data-testid="surface-frame-header"]'), 'surface frame header');
    await frames(5);
    const header = document.querySelector<HTMLElement>('[data-testid="surface-frame-header"]')!.getBoundingClientRect();
    const presets = document.querySelector<HTMLElement>('[data-testid="surface-camera-presets-slot"]')?.getBoundingClientRect();
    if (presets) {
      const overlap =
        header.left < presets.right && presets.left < header.right && header.top < presets.bottom && presets.top < header.bottom;
      noteStep(`surface header right ${header.right.toFixed(1)}, presets left ${presets.left.toFixed(1)}`);
      if (overlap) throw new Error('surface frame header and camera presets overlap');
    }
  },
  ...P3_DRIVERS,
};

export const SCENARIOS = Object.keys(DRIVERS);

export async function runScenario(name: string, ctx: ScenarioContext): Promise<void> {
  backendRef = ctx.backend;
  await DRIVERS[name](ctx);
}
