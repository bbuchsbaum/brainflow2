/**
 * Scenario drivers for the full-app harness. Each scenario uses the app's real
 * services where feasible; any direct store seeding is recorded via
 * `noteFallback` so reviewers can see where the harness departs from the app.
 */
import type { HarnessBackend } from './backend';
import { BIDS_ROOT, REMOTE_MOUNT_DEMO } from './scenarioData';
import { HARNESS_ROOT, MNI_PATH, STATS_PATH, SURFACE_OVERLAY_PATH, SURFACE_PATH } from './backend';
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
    noteStep('Set Studio demo session opened');
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
      '[role="row"][aria-label]',
      (el) => el.getAttribute('aria-label')!.startsWith('lh.inflated.gii,'),
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
  integrated: async (ctx) => DRIVERS['volume-surface'](ctx),
};

export const SCENARIOS = Object.keys(DRIVERS);

export async function runScenario(name: string, ctx: ScenarioContext): Promise<void> {
  backendRef = ctx.backend;
  await DRIVERS[name](ctx);
}
