import { buildPopulationProbeQuery } from './PopulationProbeController';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SampleFrame } from '@/plotting';
import type { PopulationProbeResult } from './PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { populationProbeActions } from './PopulationProbeActions';
import {
  composePopulationPlot,
  defaultPopulationPlotRecipe,
  type PopulationPlotRecipe,
} from './populationPlot';
export interface PinnedPopulationPlot {
  id: string;
  label: string;
  datasetKey: string;
  setId: string;
  sessionRevision: number;
  frame: SampleFrame;
  recipe: PopulationPlotRecipe;
  query: PopulationProbeResult['query'];
}
const MAX_BYTES = 16 * 1024 * 1024;
class PopulationPlotService {
  private state: readonly PinnedPopulationPlot[] = [];
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(next: readonly PinnedPopulationPlot[]) {
    if (next.length > 8 || new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES)
      throw new Error(
        'Pinned plots exceed the eight-plot / 16 MiB sample budget. Close a plot first.',
      );
    this.state = next;
    this.listeners.forEach((f) => f());
  }
  pin(result: PopulationProbeResult, frame: SampleFrame) {
    const state = useSetStudioStore.getState();
    const current = buildPopulationProbeQuery(
      state,
      useViewStateStore.getState().activeWorkspaceKey,
    );
    if (current.query?.key !== result.query.key)
      throw new Error('The population sample changed. Wait for the current sample before pinning.');
    composePopulationPlot(frame, defaultPopulationPlotRecipe);
    const feature = state.features[state.selection.activeFeatureId ?? ''];
    const plot: PinnedPopulationPlot = structuredClone({
      id: crypto.randomUUID(),
      label: `${state.sets[state.selection.activeSetId!]?.name ?? 'Population'} · ${feature?.label ?? 'Values'} · ${result.query.probe.worldMm.map((v) => v.toFixed(1)).join(', ')}`,
      datasetKey: result.query.datasetKey,
      setId: state.selection.activeSetId!,
      sessionRevision: state.population.sessionRevision,
      frame: feature?.units
        ? {
            ...frame,
            columns: frame.columns.map((c) =>
              c.name === 'value' ? { ...c, unit: feature.units } : c,
            ),
          }
        : frame,
      recipe: defaultPopulationPlotRecipe,
      query: result.query,
    });
    this.publish([...this.state, plot]);
    usePlotModeStore.getState().setActivePlotMode('population');
    const layout = useLayoutSettingsStore.getState();
    layout.setBottomDockOpen(true);
    layout.setBottomDockMinimized(false);
    layout.setBottomDockActiveTab('plot');
    return plot.id;
  }
  configure(id: string, recipe: PopulationPlotRecipe) {
    const p = this.state.find((p) => p.id === id);
    if (!p) return;
    composePopulationPlot(p.frame, recipe);
    this.publish(
      this.state.map((p) => (p.id === id ? { ...p, recipe: structuredClone(recipe) } : p)),
    );
  }
  close(id: string) {
    this.publish(this.state.filter((p) => p.id !== id));
  }
  canLink(p: PinnedPopulationPlot) {
    const s = useSetStudioStore.getState();
    return (
      p.setId === s.selection.activeSetId && p.sessionRevision === s.population.sessionRevision
    );
  }
  focus(p: PinnedPopulationPlot, id: string) {
    if (this.canLink(p)) populationProbeActions.focus(id);
  }
  select(p: PinnedPopulationPlot, id: string) {
    if (this.canLink(p)) populationProbeActions.toggle(id);
  }
  savedFor(datasetKey: string) {
    const plots = this.state.filter((p) => p.datasetKey === datasetKey && this.canLink(p));
    if (!plots.length) return undefined;
    const result = { version: 1, plots: structuredClone(plots) };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024)
      throw new Error(
        'Pinned plot samples exceed the 512 KiB study allowance. Save larger plots separately, then close them before freezing.',
      );
    return result;
  }
  prepareSaved(value: unknown): PinnedPopulationPlot[] {
    if (value === undefined || value === null) return [];
    const raw = value as { version: number; plots: PinnedPopulationPlot[] };
    if (
      raw.version !== 1 ||
      !Array.isArray(raw.plots) ||
      raw.plots.length > 8 ||
      new TextEncoder().encode(JSON.stringify(raw)).length > 512 * 1024
    )
      throw new Error('Invalid saved population plots.');
    const next = raw.plots.map((p) => {
      if (typeof p.label !== 'string' || !p.query?.probe || !p.recipe)
        throw new Error('Incomplete saved plot provenance.');
      composePopulationPlot(p.frame, p.recipe);
      return { ...structuredClone(p), id: crypto.randomUUID(), sessionRevision: -1 };
    });
    if (
      this.state.length + next.length > 8 ||
      new TextEncoder().encode(JSON.stringify([...this.state, ...next])).length > MAX_BYTES
    )
      throw new Error(
        'Close pinned plots before opening this study; its samples exceed the plot cache budget.',
      );
    return next;
  }
  restoreSaved(plots: PinnedPopulationPlot[]) {
    if (plots.length) this.publish([...this.state, ...plots]);
  }
  serialize(id: string) {
    const p = this.state.find((p) => p.id === id);
    if (!p) throw new Error('Plot unavailable.');
    return JSON.stringify({ schema: 'brainflow.population-plot.v1', plot: p }, null, 2);
  }
  reopen(text: string) {
    if (new TextEncoder().encode(text).length > MAX_BYTES)
      throw new Error('Plot file exceeds 16 MiB.');
    const raw = JSON.parse(text);
    if (
      raw.schema !== 'brainflow.population-plot.v1' ||
      !raw.plot ||
      !Array.isArray(raw.plot.frame?.rows) ||
      !Array.isArray(raw.plot.frame?.columns)
    )
      throw new Error('Unsupported population plot file.');
    const p = raw.plot as PinnedPopulationPlot;
    if (typeof p.label !== 'string' || !p.query?.probe || !p.recipe)
      throw new Error('Incomplete plot provenance.');
    composePopulationPlot(p.frame, p.recipe);
    // Portable sample receipts reopen detached: matching strings do not prove live identity.
    this.publish([...this.state, { ...p, id: crypto.randomUUID(), sessionRevision: -1 }]);
  }
}
export const populationPlotService = new PopulationPlotService();
