/**
 * Scenario drivers for the full-app harness. Each scenario uses the app's real
 * services where feasible; any direct store seeding is recorded via
 * `noteFallback` so reviewers can see where the harness departs from the app.
 */
import type { HarnessBackend } from './backend';
import { BIDS_ROOT, REMOTE_MOUNT_DEMO } from './scenarioData';
import {
  ATLAS_PATH,
  FIG_LH_MID_PATH,
  FIG_LH_OVERLAY_PATH,
  FIG_LH_PATH,
  FIG_RH_OVERLAY_PATH,
  FIG_RH_PATH,
  HARNESS_ROOT,
  MNI_PATH,
  MNI_MASK_PATH,
  STATS_PATH,
  SURFACE_OVERLAY_PATH,
  SURFACE_PATH,
  TMAP_PATH,
  TMAP_NOISY_PATH,
  ZMAP_MULTIPEAK_PATH,
  ZMAP_NOISY_PATH,
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

/** The multirun study (E5b): three runs loaded, the Series at the block voxel, run 2's peak focused. */
async function seriesRuns(): Promise<void> {
  await p3Base(['anat']);
  const { multirunPath, MULTIRUN_VOXEL_MM } = await import('./multirun');
  // As in the native check (round 2): run 1 loaded and the Series open, then
  // runs 2 and 3 added one at a time while the view groups them, so the run
  // group forms (and re-forms) while later runs are still loading and refining.
  await loadVolume(multirunPath(1), 'add-layer');
  await selectLayer(multirunPath(1));
  await navigateTo([...MULTIRUN_VOXEL_MM] as [number, number, number]);
  const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
  const { usePlotModeStore } = await import('@/stores/plotModeStore');
  const { useSeriesStore } = await import('@/stores/seriesStore');
  useSeriesStore.getState().update({ locus: 'point', segments: 'auto', segmentLayout: null });
  useLayoutSettingsStore.getState().setBottomDockOpen(true);
  useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
  useLayoutSettingsStore.getState().setBottomDockHeight(320);
  usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
  for (const run of [2, 3]) await loadVolume(multirunPath(run), 'add-layer');
  // Native round 3: whichever run is focused (Inspector selection), only it is drawn.
  {
    const { useViewStateStore: vs } = await import('@/stores/viewStateStore');
    const ids = await Promise.all([1, 2, 3].map((n) => layerIdForPath(multirunPath(n))));
    const drawn = () => ids.map((id) => !!vs.getState().viewState.layers.find((x) => x.id === id)?.visible);
    for (const focus of [1, 3, 1]) {
      await selectLayer(multirunPath(focus));
      await frames(20);
      await new Promise((r) => setTimeout(r, 400)); // GPU promotions and patches settle
      const want = [1, 2, 3].map((n) => n === focus);
      if (drawn().join() !== want.join())
        throw new Error(`run ${focus} focused: drawn ${drawn().map((v, i) => `run ${i + 1}=${v}`).join(' ')} (want only run ${focus})`);
      noteStep(`run ${focus} focused: only run ${focus} drawn`);
    }
  }
  await until(() => document.querySelectorAll('[data-testid="plot-x-rule"]').length === 3, 'three run boundaries');
  {
    const { useLayerStore: store } = await import('@/stores/layerStore');
    const { useViewStateStore: vs } = await import('@/stores/viewStateStore');
    const snap = (tag: string) =>
      noteStep(`${tag}: ${store.getState().layers.map((l) => `${l.name}=${l.visible ? 'shown' : 'hidden'}/${vs.getState().viewState.layers.find((x) => x.id === l.id)?.visible}`).join(' | ')}`);
    snap('formed');

  }
  // Round 3 C2: Right from run 1's last frame goes to run 2's first.
  {
    const last = document.querySelector<SVGElement>('[data-testid="crosshair-ts-plot-body"] [data-datum-id="0:19"]')!;
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await until(() => document.activeElement?.getAttribute('data-datum-id') === '1:0', 'ArrowRight into run 2');
    noteStep(`keys: run 1 frame 20 → ${document.activeElement?.getAttribute('aria-label')}`);
    {
      const { useLayerStore: store } = await import('@/stores/layerStore');
      const { useViewStateStore: vs } = await import('@/stores/viewStateStore');
      noteStep(`after keys: ${store.getState().layers.map((l) => `${l.name}=${l.visible ? 'shown' : 'hidden'}/${vs.getState().viewState.layers.find((x) => x.id === l.id)?.visible}`).join(' | ')}`);
    }
  }
  (document.querySelector('[data-testid="crosshair-ts-plot-body"] [data-datum-id="1:12"]') as SVGElement).dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  );
  const { useLayerStore } = await import('@/stores/layerStore');
  const run2 = await layerIdForPath(multirunPath(2));
  await until(
    () => useLayerStore.getState().selectedLayerId === run2 && useLayerStore.getState().layers.find((l) => l.id === run2)?.currentTimepoint === 12,
    'run 2 frame 12 focused',
  );
  await until(() => /run 2 · frame 13\/24/.test(document.querySelector('[data-testid="raw-series-caption"]')?.textContent ?? ''), 'run counter');
  const peak = document.querySelector('[data-testid="crosshair-ts-plot-body"] [data-datum-id="1:12"]')?.getAttribute('aria-label');
  noteStep(`runs: ${Array.from(document.querySelectorAll('[data-testid="plot-x-rule"]')).map((e) => e.textContent).join(' | ')}; peak ${peak}`);
  noteStep(`caption: ${document.querySelector('[data-testid="raw-series-caption"]')?.textContent}`);
  // Round 3 F1: an EPI view of the focused run only, windowed over its data.
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  await until(() => {
    const l = useViewStateStore.getState().viewState.layers.find((x) => x.id === run2);
    return !!l && l.colormap === 'gray' && l.intensity[1] - l.intensity[0] > 1;
  }, 'run 2 EPI window');
  // Native R2-1 / R2-2: one pooled window for every run; only the focused run drawn.
  {
    const runIds = await Promise.all([1, 2, 3].map((n) => layerIdForPath(multirunPath(n))));
    await until(() => {
      const views = runIds.map((id) => useViewStateStore.getState().viewState.layers.find((x) => x.id === id));
      const w = views.map((v) => v?.intensity.join(','));
      return views.every((v) => v?.colormap === 'gray') && new Set(w).size === 1;
    }, 'one pooled window for all runs');
    const views = runIds.map((id) => useViewStateStore.getState().viewState.layers.find((x) => x.id === id));
    if (views[0]?.visible || !views[1]?.visible || views[2]?.visible)
      throw new Error(`run visibility ${views.map((v) => v?.visible).join('/')} (want hidden/shown/hidden)`);
  }
  const view = useViewStateStore.getState().viewState.layers;
  noteStep(
    `runs display: ${[1, 2, 3]
      .map((n) => view.find((l) => l.id === useLayerStore.getState().layers.find((x) => x.sourcePath === multirunPath(n))?.id))
      .map((l, i) => `run ${i + 1} ${l?.visible ? 'shown' : 'hidden'} ${l?.colormap} [${l?.intensity.map((v) => v.toFixed(2)).join(', ')}]`)
      .join(' | ')}`,
  );
}

/** The series caption has settled (no "sampling…"), round 3 T4. */
async function seriesSettled(): Promise<void> {
  await until(() => {
    const text = document.querySelector('[data-testid="raw-series-caption"]')?.textContent ?? '';
    return text.length > 0 && !/sampling/.test(text);
  }, 'series sampled');
}

async function p3Base(expand: string[] = ['anat', 'stats']): Promise<void> {
  await servicesReady();
  await mountStudy(expand);
  await loadVolume(MNI_PATH);
}

const loadZ = () => loadStat(ZMAP_PATH, [-6, 6], [-3.1, 3.1]);

/** Load a native-like statistic with no scenario window; assert the default display. */
async function nativeStatistic(path: string): Promise<void> {
  await p3Base();
  await loadVolume(path, 'add-layer');
  const id = await layerIdForPath(path);
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  await until(() => !!useViewStateStore.getState().viewState.layers.find((l) => l.id === id), 'statistic layer committed');
  await frames(20);
  const layer = useViewStateStore.getState().viewState.layers.find((l) => l.id === id)!;
  const [lo, hi] = layer.intensity;
  const [tlo, thi] = layer.threshold;
  noteStep(`default window ${lo}..${hi}, threshold ${tlo}..${thi}, colormap ${layer.colormap}`);
  if (!(hi >= 3 && Math.abs(lo + hi) < 1e-6)) throw new Error(`statistic window not symmetric ±max|v|: ${lo}..${hi}`);
  if (!(Math.abs(tlo + 3.1) < 1e-6 && Math.abs(thi - 3.1) < 1e-6)) throw new Error(`statistic threshold not |v| ≤ 3.1: ${tlo}..${thi}`);
  // The T1 stays visible: a brain point away from every blob reads gray.
  const point = await clientPointOf('axial', [20, -40, useViewStateStore.getState().viewState.crosshair.world_mm[2]]);
  const ctx = point.canvas.getContext('2d');
  const rect = point.canvas.getBoundingClientRect();
  const cx = Math.round(((point.x - rect.left) * point.canvas.width) / rect.width);
  const cy = Math.round(((point.y - rect.top) * point.canvas.height) / rect.height);
  const [r, g, b] = ctx ? Array.from(ctx.getImageData(cx, cy, 1, 1).data) : [0, 0, 0];
  noteStep(`axial pixel at (20, -40): rgb ${r},${g},${b}`);
  const gray = Math.abs(r - g) < 16 && Math.abs(g - b) < 16;
  if (!gray || r < 30) throw new Error(`T1 hidden under the statistic overlay: rgb ${r},${g},${b}`);
}

/** Figure row at 183 mm with Crop to brain; T1 + dense noisy z map. */
async function nativeExportCrop(order: 't1-first' | 'z-first'): Promise<void> {
  await servicesReady();
  await mountStudy(['anat', 'stats']);
  if (order === 't1-first') {
    await loadVolume(MNI_PATH);
    await loadVolume(ZMAP_NOISY_PATH, 'add-layer');
  } else {
    await loadVolume(ZMAP_NOISY_PATH);
    await loadVolume(MNI_PATH, 'add-layer');
  }
  await frames(10);
  const { useExportDialogStore } = await import('@/stores/exportDialogStore');
  const store = useExportDialogStore.getState();
  store.applyPreset('figure');
  store.setCropToBrain(true);
  store.setSize({ kind: 'print', widthMm: 183, dpi: 300 });
  store.open();
  await exportSettled();
  const before = useExportDialogStore.getState().imageUrl;
  useExportDialogStore.getState().setExportTarget('orthogonal-row');
  await until(() => useExportDialogStore.getState().imageUrl !== before, 'figure row composed');
  await exportSettled();
  const size = useExportDialogStore.getState().outputSize;
  noteStep(`crop (${order}): ${size?.width} × ${size?.height} px`);
  // The clean z map's figure row is 2161 × ~722 px (cropped to the brain);
  // an uncropped field of view is far taller.
  if (!size || size.height > 800) throw new Error(`crop widened by the noisy statistic: ${size?.width} × ${size?.height}`);
}

/**
 * Native recheck (v6): every Compare colorbar caption line lies inside its
 * pane and is not cut ("z · zmap_sy…" was clipped at the pane edge).
 */
function assertCompareCaptionsInside(): void {
  const panes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="comparison-panel"]'));
  for (const pane of panes) {
    const box = pane.getBoundingClientRect();
    const lines = pane.querySelectorAll<HTMLElement>(
      '[data-testid="viewport-colorbar-name"], [data-testid="viewport-colorbar-name-line"], [data-testid="viewport-colorbar-tag"]',
    );
    for (const line of Array.from(lines)) {
      const text = line.firstElementChild as HTMLElement | null;
      const r = (text ?? line).getBoundingClientRect();
      const inside = r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      const cut = line.scrollWidth > line.clientWidth + 1;
      noteStep(`caption "${line.textContent}" in panel ${pane.dataset.panelLetter}: ${inside ? 'inside' : 'OUTSIDE'}${cut ? ', cut' : ''}`);
      if (!inside || cut) throw new Error(`Compare caption "${line.textContent}" leaves its pane or is cut`);
    }
  }
}

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
/**
 * Phase 4 (D): load the figure set's meshes / overlays (backend FIG_ROOT),
 * wait for the surface tab named `tab`, its canvas, and every loaded surface's
 * folding underlay from its sulc file.
 */
const FIG_OVERLAY_THRESHOLD = 30000;

async function figureSurfaces(paths: string[], tab: string): Promise<void> {
  await p3Base(['anat']);
  const { useSurfaceStore } = await import('@/stores/surfaceStore');
  for (const path of paths) {
    await loadVolume(path);
    await frames(5);
  }
  await until(
    () =>
      Array.from(document.querySelectorAll('.lm_tab.lm_active .lm_title')).some(
        (el) => el.textContent?.trim() === tab,
      ),
    `surface tab ${tab} active (tabs: ${Array.from(document.querySelectorAll('.lm_tab .lm_title'))
      .map((el) => el.textContent?.trim())
      .join(', ')})`,
  );
  await until(() => !!document.querySelector('.lm_content canvas'), 'surface canvas');
  await until(
    () => [...useSurfaceStore.getState().surfaces.values()].every((s) => s.curvatureSource?.kind === 'file'),
    'folding underlay from the sulc files',
  );
  // A figure's threshold: values below 30000 (about half the overlay's
  // range) are not drawn, so the folding underlay shows through.
  for (const surface of useSurfaceStore.getState().surfaces.values()) {
    for (const layer of surface.layers.values()) {
      useSurfaceStore.getState().updateLayerProperty(surface.handle, layer.id, 'threshold', [0, FIG_OVERLAY_THRESHOLD]);
    }
  }
  for (const surface of useSurfaceStore.getState().surfaces.values()) {
    const sorted = Float32Array.from(surface.curvature ?? []).sort();
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]?.toFixed(2);
    noteStep(
      `${surface.name} (${surface.metadata.hemisphere}): underlay ${surface.curvatureSource?.kind} ${sorted.length} values, p2 ${q(0.02)} p50 ${q(0.5)} p98 ${q(0.98)}`,
    );
  }
  await dismissLoadToasts();
  await frames(20);
}

/** Make the visible surface view the active render context (what pointer entry does). */
async function activateSurfaceView(): Promise<void> {
  const canvas = Array.from(document.querySelectorAll<HTMLCanvasElement>('.lm_content canvas')).find(
    (c) => c.getBoundingClientRect().width > 0,
  );
  if (!canvas) throw new Error('no visible surface canvas');
  canvas.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  const { useActiveRenderContextStore } = await import('@/stores/activeRenderContextStore');
  await until(
    () => String(useActiveRenderContextStore.getState().activeId ?? '').startsWith('surfaceview:'),
    'surface view active',
  );
  noteStep(`active view: ${useActiveRenderContextStore.getState().activeId}`);
}

/**
 * Phase 4 E6: the synthetic FIR study (firStudy.ts) as the active dataset,
 * the crosshair at its response centre, and the Plot dock's Series mode.
 * Notes every plotted population value (recomputed through the same
 * composer) so the fidelity critic can check them against firValue.
 */
async function firSeries(
  variant: '3d' | '4d',
  settings: Partial<import('@/stores/seriesStore').SeriesSettings>,
  before?: () => Promise<void>,
): Promise<void> {
  await p3Base(['anat']);
  if (before) await before();
  const { useSetStudioStore } = await import('@/stores/setStudioStore');
  const { firSet, FIR_CENTRE } = await import('./firStudy');
  useSetStudioStore.getState().bootstrapStudio({
    set: firSet(variant),
    features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
    cohorts: [],
    expressions: [],
  } as never);
  noteStep(`dataset ${firSet(variant).name}: ${firSet(variant).memberCount} members`);
  if (!settings.locus || settings.locus !== 'cluster') await navigateTo([...FIR_CENTRE] as [number, number, number]);
  const { useSeriesStore } = await import('@/stores/seriesStore');
  useSeriesStore.getState().reset();
  useSeriesStore.getState().update(settings);
  const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
  const { usePlotModeStore } = await import('@/stores/plotModeStore');
  useLayoutSettingsStore.getState().setBottomDockOpen(true);
  useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
  useLayoutSettingsStore.getState().setBottomDockHeight(380);
  usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
  await until(
    () => !!document.querySelector('[data-testid="series-plot"] svg') && !/sampling/.test(document.querySelector('[data-testid="series-caption"]')?.textContent ?? ''),
    'series plotted',
  );
  await noteSeriesValues();
  await frames(5);
}

async function noteSeriesValues(): Promise<void> {
  const { useSetStudioStore } = await import('@/stores/setStudioStore');
  const { useSeriesStore } = await import('@/stores/seriesStore');
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  const { sampleSetSeries } = await import('@/services/series/sampleSetSeries');
  const { seriesRecipe } = await import('@/services/series/seriesRecipe');
  const { SERIES_X } = await import('@/services/series/seriesBinding');
  const { composePopulationPlot } = await import('@/services/studio/populationPlot');
  const settings = useSeriesStore.getState();
  const view = useViewStateStore.getState();
  const { resolveSeriesRegion } = await import('@/services/series/seriesRegion');
  const { seriesRadiusMm } = await import('@/stores/seriesStore');
  const world = view.viewState.crosshair.world_mm;
  const region = await resolveSeriesRegion(settings, world);
  if (region && !region.region) throw new Error(region.issue);
  if (region?.region) noteStep(`series region: ${region.label} ${JSON.stringify(region.region)}`);
  const { frame, binding } = await sampleSetSeries(
    useSetStudioStore.getState(),
    view.activeWorkspaceKey,
    { worldMm: world, radiusMm: seriesRadiusMm(settings), reduce: 'mean', region: region?.region ?? null },
    new AbortController().signal,
  );
  const out = composePopulationPlot(frame, seriesRecipe(binding, settings)).frame;
  noteStep(`series caption: ${document.querySelector('[data-testid="series-caption"]')?.textContent}`);
  for (const row of out.rows) {
    const f = (v: unknown) => (typeof v === 'number' ? v.toFixed(4) : String(v));
    noteStep(
      `series ${row[binding.conditionColumn ?? ''] ?? ''} x=${row[SERIES_X]}: value ${f(row.value)} [${f(row.lower)}, ${f(row.upper)}] n=${row.count ?? 1}`,
    );
  }
}

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
  // Phase 4 C1/C2: the same table with cluster p (RFT, a stated 8 mm FWHM)
  // and cluster 1's sub-peaks open (region per sub-peak).
  // Round 3 T2: the same map searched inside the MNI brain mask (truth:
  // p4_fixtures.json clustersMultipeak.rftBrainMask): the methods name the mask
  // and the mask voxels where the map is 0.
  'cluster-search-mask': async () => {
    await p3Base();
    await loadStat(ZMAP_MULTIPEAK_PATH, [-6, 6], [-3.1, 3.1]);
    await loadVolume(MNI_MASK_PATH, 'add-layer');
    const maskId = await layerIdForPath(MNI_MASK_PATH);
    const { useViewStateStore } = await import('@/stores/viewStateStore');
    useViewStateStore.getState().setViewState((state) => {
      const mask = state.layers.find((l) => l.id === maskId);
      if (mask) {
        mask.visible = false;
        mask.opacity = 0;
      }
    });
    await selectLayer(ZMAP_MULTIPEAK_PATH);
    window.dispatchEvent(new CustomEvent('golden-layout-add-panel', { detail: { panelType: 'ClusterPanel' } }));
    await until(() => !!document.querySelector('[data-testid="cluster-panel"]'), 'Clusters dock tab');
    const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
    useLayoutSettingsStore.getState().setBottomDockHeight(360);
    const { useClusterStore } = await import('@/stores/clusterStore');
    useClusterStore.getState().setParams({ extentP: true, fwhmText: '8', searchMaskLayerId: maskId });
    await frames(2);
    await clickWhere('[data-testid="cluster-panel"] button', (el) => el.textContent?.trim() === 'Compute', 'Compute');
    await until(() => !!document.querySelector('[data-testid="cluster-pfwe-1"]'), 'p(FWE) column');
    const table = useClusterStore.getState().result!.table;
    if (table.searchVolume?.kind !== 'mask') throw new Error(`search volume ${JSON.stringify(table.searchVolume)}`);
    noteStep(`search ${JSON.stringify(table.searchVolume)}; clusters ${table.clusters.map((c) => c.voxelCount).join(', ')}`);
    noteStep(`methods: ${document.querySelector('[data-testid="cluster-methods"]')?.textContent}`);
    await frames(3);
  },
  'cluster-subpeaks-rft': async () => {
    // The z map with two extra blobs inside cluster 1 (fixtures.ts
    // MULTIPEAK_BLOBS), the atlas hidden for the Region column.
    await p3Base();
    await loadStat(ZMAP_MULTIPEAK_PATH, [-6, 6], [-3.1, 3.1]);
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
    await selectLayer(ZMAP_MULTIPEAK_PATH);
    window.dispatchEvent(new CustomEvent('golden-layout-add-panel', { detail: { panelType: 'ClusterPanel' } }));
    await until(() => !!document.querySelector('[data-testid="cluster-panel"]'), 'Clusters dock tab');
    // Room for the sub-peak rows (what dragging the dock edge does).
    const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
    useLayoutSettingsStore.getState().setBottomDockHeight(360);
    await clickWhere('[data-testid="cluster-panel"] label', (el) => el.textContent?.trim() === 'Cluster p (RFT)', 'Cluster p (RFT)');
    const field = document.querySelector<HTMLInputElement>('#cluster-fwhm');
    if (!field) throw new Error('FWHM field not shown');
    // As typing does: React's onChange through the native value setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '8');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await frames(2);
    await clickWhere('[data-testid="cluster-panel"] button', (el) => el.textContent?.trim() === 'Compute', 'Compute');
    await until(() => !!document.querySelector('[data-testid="cluster-pfwe-1"]'), 'p(FWE) column');
    const { useClusterStore } = await import('@/stores/clusterStore');
    const table = useClusterStore.getState().result!.table;
    const firstWithPeaks = table.clusters.find((c) => c.subPeaks.length > 0);
    if (!firstWithPeaks) throw new Error('no cluster with sub-peaks in the multipeak map');
    // Select the row (the selection edge shows with and without focus, v1 F5).
    (document.querySelector(`[data-testid="cluster-row-${firstWithPeaks.id}"]`) as HTMLElement).click();
    await until(() => useClusterStore.getState().selectedId === firstWithPeaks.id, 'cluster row selected');
    {
      const row = document.querySelector<HTMLElement>(`[data-testid="cluster-row-${firstWithPeaks.id}"]`)!;
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await until(() => !!document.querySelector(`[data-testid="cluster-subpeak-${firstWithPeaks.id}-2"]`), 'sub-peak rows');
    }
    for (const c of table.clusters) {
      noteStep(
        `cluster ${c.id}: ${c.voxelCount} vox, p(FWE) ${c.pFweExtent?.toExponential(3)}, p(unc) ${c.pUncorrectedExtent?.toExponential(3)}, sub-peaks ${c.subPeaks
          .map((p) => `${p.value.toFixed(2)}@${p.ijk.join(' ')}`)
          .join('; ')}`,
      );
    }
    const inf = table.extentInference!;
    noteStep(`RFT: resels ${inf.resels.map((r) => r.toFixed(2)).join(' ')}, Ec ${inf.expectedClusters.toFixed(3)}, search ${inf.searchVoxels} vox`);
    noteStep(`methods: ${document.querySelector('[data-testid="cluster-methods"]')?.textContent}`);
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
    // Native v6: every tile renders without a resize (no cell left on
    // "Loading…" after the provisional grid is replaced by the fitted one).
    await until(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('.mosaic-cell')).every(
          (cell) => !/Loading/.test(cell.textContent ?? ''),
        ),
      'every mosaic tile rendered',
    );
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
      (el) => el.textContent?.trim() === 'Export view as image…',
      "context menu 'Export view as image…'",
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
    assertCompareCaptionsInside();
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
  // Phase 4 D2: the grey folding underlay (synthetic sulc file next to the
  // mesh) under the thresholded overlay, with the orientation glyph (D5).
  'surface-folding': async () => {
    await figureSurfaces([FIG_LH_PATH, FIG_LH_OVERLAY_PATH], 'lh.inflated.gii');
    // The mesh's Inspector Geometry section: the "Folding" switch and its source.
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useSurfaceStore } = await import('@/stores/surfaceStore');
    const { useInspectorSelectionStore } = await import('@/stores/inspectorSelectionStore');
    const { buildSceneStack } = await import('@/hooks/useSceneStack');
    const stack = buildSceneStack(useLayerStore.getState().layers, useSurfaceStore.getState().surfaces, null);
    const item = stack.surfaces.find((s) => s.kind === 'surface-geometry');
    if (!item) throw new Error('no surface geometry scene item');
    useInspectorSelectionStore.getState().setActive(item);
    await until(() => !!document.querySelector('[aria-label="Folding underlay"]'), 'Folding switch');
    noteStep(`Folding: ${document.querySelector('[aria-label="Folding underlay"]')?.getAttribute('aria-checked')}`);
    await frames(5);
  },
  // Phase 4 fixtures: the right hemisphere, lateral preset (camera from +x).
  'surface-rh-lateral': async () => {
    await figureSurfaces([FIG_RH_PATH, FIG_RH_OVERLAY_PATH], 'rh.inflated.gii');
    await clickWhere(
      '[data-testid="surface-camera-presets"] [role="radio"], [data-testid="surface-camera-presets"] button',
      (el) => el.textContent?.trim() === 'Lateral',
      "surface preset 'Lateral'",
    );
    await frames(20);
    const { useSurfaceCameraStore } = await import('@/stores/surfaceCameraStore');
    for (const [view, basis] of useSurfaceCameraStore.getState().bases) {
      noteStep(`camera ${view}: forward ${basis.forward.map((v) => v.toFixed(2)).join(' ')}`);
    }
  },
  // Phase 4 D3/D4: "Surface lateral + medial" for both hemispheres at
  // 183 mm, 300 dpi (Figure preset): four poses, one colorbar, a glyph each.
  'surface-lat-med': async () => {
    await figureSurfaces(
      [FIG_LH_PATH, FIG_LH_OVERLAY_PATH, FIG_RH_PATH, FIG_RH_OVERLAY_PATH],
      'lh.inflated.gii',
    );
    await activateSurfaceView();
    const { useExportDialogStore } = await import('@/stores/exportDialogStore');
    const store = useExportDialogStore.getState();
    store.applyPreset('figure');
    store.setSize({ kind: 'print', widthMm: 183, dpi: 300 });
    store.open();
    await exportSettled();
    const before = useExportDialogStore.getState().imageUrl;
    useExportDialogStore.getState().setExportTarget('surface-lat-med');
    await until(() => useExportDialogStore.getState().imageUrl !== before, 'lateral + medial composed');
    await exportSettled();
    noteStep(`export: ${document.querySelector('[data-testid="export-size"]')?.textContent}`);
    noteStep(`file: ${useExportDialogStore.getState().suggestedName}`);
  },
  // Phase 4 D1: the status bar's Vertex slot on the inflated view, read on
  // the (synthetic) midthickness: the vertex at the overlay's peak, with an
  // independent nearest-vertex check of the displayed index and value.
  'surface-vertex': async (ctx) => {
    await figureSurfaces([FIG_LH_PATH, FIG_LH_OVERLAY_PATH, FIG_LH_MID_PATH], 'lh.midthickness.gii');
    await clickByText('.lm_tab .lm_title', 'lh.inflated.gii');
    await frames(10);
    await activateSurfaceView();
    const overlay = ctx.fixtures.surface.overlay;
    let peak = 0;
    for (let i = 1; i < overlay.length; i += 1) if (overlay[i] > overlay[peak]) peak = i;
    const { useSurfaceStore } = await import('@/stores/surfaceStore');
    const mid = [...useSurfaceStore.getState().surfaces.values()].find((s) => s.metadata.surfaceType === 'midthickness')!;
    const v = mid.geometry.vertices;
    await navigateTo([v[3 * peak], v[3 * peak + 1], v[3 * peak + 2]]);
    await frames(5);
    const { useViewStateStore } = await import('@/stores/viewStateStore');
    const c = useViewStateStore.getState().viewState.crosshair.world_mm;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < v.length / 3; i += 1) {
      const d = (v[3 * i] - c[0]) ** 2 + (v[3 * i + 1] - c[1]) ** 2 + (v[3 * i + 2] - c[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    await until(() => !!document.querySelector('[data-testid="status-vertex"]'), 'status Vertex slot');
    const shown = document.querySelector('[data-testid="status-vertex"]')?.textContent ?? '';
    noteStep(`crosshair ${c.map((x) => x.toFixed(1)).join(' ')}; peak vertex ${peak}; nearest ${best} at ${Math.sqrt(bestD).toFixed(2)} mm, value ${overlay[best]}`);
    noteStep(`status Vertex: ${shown}`);
    if (shown.replace(/,/g, '').trim().split(/\s+/)[0] !== String(best)) throw new Error(`status shows "${shown}", expected vertex ${best}`);
  },
  // Phase 4 E6: FIR series (3D lag maps), 6 mm sphere, mean ± 95% CI (t).
  'series-fir-sphere': async () => firSeries('3d', { radiusMm: 6, band: 'ci95' }),
  // v1 fidelity 7: the ± 1.96 SE band says it is a normal approximation at n = 6.
  'series-fir-sem95': async () => {
    await firSeries('3d', { radiusMm: 6, band: 'sem95' });
    await until(() => /normal approx\., n = 6/.test(document.querySelector('[data-testid="series-caption"]')?.textContent ?? ''), 'sem95 caption');
  },
  // Phase 4 E6: the same study as 4D lag series, faces − houses (paired) with
  // a 0–0 TR baseline: one difference line, mean ± 95% CI (t).
  'series-fir-diff': async () =>
    firSeries('4d', {
      radiusMm: 6,
      // v1 F7: the t-based 95% CI is the default everywhere, differences too.
      band: 'ci95',
      transforms: [
        { kind: 'baseline', from: 0, to: 0 },
        { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
      ],
    }),
  // Phase 4 E6 (E2): the FIR series over the atlas region at the response
  // centre (L_sensorimotor of the harness atlas, hidden), mean ± 95% CI.
  'series-region': async () =>
    firSeries('3d', { locus: 'region', band: 'ci95' }, async () => {
      await loadVolume(ATLAS_PATH, 'add-layer');
      const atlasId = await layerIdForPath(ATLAS_PATH);
      const { useViewStateStore } = await import('@/stores/viewStateStore');
      useViewStateStore.getState().setViewState((state) => {
        const atlas = state.layers.find((l) => l.id === atlasId);
        if (atlas) atlas.opacity = 0;
      });
      noteStep('atlas loaded, opacity 0 (region source only)');
    }),
  // Phase 4 E6 (E3): the FIR series over cluster 1 of the z map at |z| > 3.1
  // (26-connected, the cluster-id label volume), 4D members.
  'series-cluster': async () =>
    firSeries('4d', { locus: 'cluster', band: 'ci95' }, async () => {
      await loadZ();
      const zId = await layerIdForPath(ZMAP_PATH);
      const { getClusterService } = await import('@/services/ClusterService');
      const { useClusterStore } = await import('@/stores/clusterStore');
      await getClusterService().compute({ layerId: zId, threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
      await getClusterService().selectCluster(1);
      const t = useClusterStore.getState().result!.table;
      noteStep(`clusters: ${t.clusters.length}, row 1 ${t.clusters[0].voxelCount} vox, label volume ${t.labelVolumeId}`);
    }).then(async () => {
      // v1 function 2: with the dataset bound and row 1 selected, "Series for
      // cluster 1" is available, though the z map is not the active layer.
      const { clusterSeriesUnavailable } = await import('@/services/series/openClusterSeries');
      const reason = clusterSeriesUnavailable();
      noteStep(`Series for cluster 1: ${reason ?? 'available'}`);
      if (reason) throw new Error(`Series for cluster 1 unavailable: ${reason}`);
    }),
  // Phase 4 E6: the FIR series at the narrow window (1280 × 800 variant).
  'series-1280': async () => firSeries('3d', { radiusMm: 6, band: 'ci95' }),
  // Phase 4 E6: a raw 4D layer (one subject's faces FIR series) at the
  // crosshair: the Series mode on the layer, frame 2 selected from the plot.
  'series-raw4d': async () => {
    await p3Base(['anat']);
    const { fir4dPath, FIR_CENTRE, firSet } = await import('./firStudy');
    // The layer is a member of the 4D FIR study: its series uses the study's
    // lag axis (round 2 X3), "Lag (TR)" from 0, like the dataset series.
    const { useSetStudioStore } = await import('@/stores/setStudioStore');
    useSetStudioStore.getState().bootstrapStudio({
      set: firSet('4d'),
      features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
      cohorts: [],
      expressions: [],
    } as never);
    const path = fir4dPath('s01', 'faces');
    await loadVolume(path, 'add-layer');
    await selectLayer(path);
    await navigateTo([...FIR_CENTRE] as [number, number, number]);
    const { useSeriesStore } = await import('@/stores/seriesStore');
    useSeriesStore.getState().reset();
    useSeriesStore.getState().update({ source: 'layer', locus: 'point' });
    const { useLayoutSettingsStore } = await import('@/stores/layoutSettingsStore');
    const { usePlotModeStore } = await import('@/stores/plotModeStore');
    useLayoutSettingsStore.getState().setBottomDockOpen(true);
    useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
    useLayoutSettingsStore.getState().setBottomDockHeight(320);
    usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
    await until(() => document.querySelectorAll('[data-testid="crosshair-ts-plot-body"] [data-datum-id]').length >= 8, 'raw 4D series points');
    (document.querySelector('[data-testid="crosshair-ts-plot-body"] [data-datum-id="0:2"]') as SVGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const { useLayerStore } = await import('@/stores/layerStore');
    const id = await layerIdForPath(path);
    await until(() => useLayerStore.getState().layers.find((l) => l.id === id)?.currentTimepoint === 2, 'frame 2 selected');
    noteStep(
      `raw 4D points: ${Array.from(document.querySelectorAll('[data-testid="crosshair-ts-plot-body"] [data-datum-id]'))
        .map((el) => el.getAttribute('aria-label'))
        .join(' | ')}`,
    );
    await frames(5);
  },
  // Phase 4 E5b: one subject's three runs (truth: p4_fixtures.json
  // `multirun`), concatenated with labelled run boundaries; a click on run 2's
  // peak focuses run 2's layer and frame 12 ("run 2 · frame 13/24").
  'series-runs-concat': async () => {
    await seriesRuns();
    await seriesSettled();
    await frames(5);
  },
  // The same runs faceted: one panel per run on a shared y axis.
  'series-runs-faceted': async () => {
    await seriesRuns();
    const { useSeriesStore } = await import('@/stores/seriesStore');
    useSeriesStore.getState().update({ segmentLayout: 'faceted' });
    await until(() => document.querySelectorAll('[data-testid="plot-facets"] [data-testid="plot-mark-line"]').length === 3, 'three run facets');
    await seriesSettled();
    const peak = document.querySelector('[data-testid="plot-facets"] [data-datum-id="1:12"]')?.getAttribute('aria-label') ?? '';
    if (!/^run 2 · frame 13\/24.*122/.test(peak)) throw new Error(`faceted run 2 peak label: ${peak}`);
    noteStep(`faceted peak: ${peak}`);
    await frames(5);
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
  // Native check v6: a statistic file as it really is (~1e-5 noise in 93% of
  // voxels), loaded WITHOUT a scenario-set window. Asserts the statistic
  // default (symmetric ±max|v|, |v| ≤ 3.1 hidden) and that the T1 is still
  // visible under the overlay away from the blobs (pixel check).
  'native-zmap': async () => nativeStatistic(ZMAP_NOISY_PATH),
  'native-tmap': async () => nativeStatistic(TMAP_NOISY_PATH),
  // Native check v6: Crop to brain with a dense noisy z map (93% non-zero),
  // in both load orders: the crop is the brain (+6%), never the whole field
  // of view. Asserts the figure-row output height matches the clean map's.
  'native-export-crop': async () => nativeExportCrop('t1-first'),
  'native-export-crop-zfirst': async () => nativeExportCrop('z-first'),
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
