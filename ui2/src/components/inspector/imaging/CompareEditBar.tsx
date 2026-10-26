import { SegmentedControl, Select } from '@/components/ui/bf';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { panelLetter, type CompareLinkMode } from '@/types/comparison';
import {
  linkModeOf,
  panelLayerIdOf,
  resolveActivePanel,
  thresholdMismatch,
} from '@/utils/compareDisplay';
import { thresholdWording } from '@/components/views/viewportFrame/frameFormat';
import { statisticUnits, statisticVariable } from '@/utils/statistic';
import { ThresholdText } from '@/components/ui/ThresholdText';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

const LINK_OPTIONS = [
  { value: 'all', label: 'Link all' },
  { value: 'window', label: 'Link window' },
  { value: 'threshold', label: 'Link threshold' },
  { value: 'none', label: 'Link none' },
] as const;

/**
 * Inspector scope line in a Compare workspace (P3.9): what the display edits
 * apply to, "Editing: panel B · zmap_synthetic" or "Editing: all panels",
 * with the link mode beside it. While something is per panel, a small
 * picker (A / B / … / Both) chooses the panel; the panel itself shows the
 * amber edge.
 */
export function CompareEditBar() {
  const workspaceId = useWorkspaceStore((s) => {
    const ws = s.activeWorkspaceId ? s.getWorkspace(s.activeWorkspaceId) : null;
    return ws?.type === 'comparison' ? ws.id : null;
  });
  const mode = useComparisonStore((s) => (workspaceId ? linkModeOf(s, workspaceId) : 'all'));
  const panels = useComparisonStore((s) => (workspaceId ? s.panels.get(workspaceId) : undefined));
  // Select primitives (a fresh object per call would never settle).
  const activeId = useComparisonStore((s) =>
    workspaceId ? (resolveActivePanel(s, workspaceId)?.panel.id ?? null) : null,
  );
  const scope = useComparisonStore((s) =>
    workspaceId ? (s.editScopes.get(workspaceId) ?? 'panel') : 'panel',
  );
  const viewLayers = useViewStateStore((s) =>
    workspaceId ? s.getWorkspaceViewState(workspaceId).layers : s.viewState.layers,
  );
  const layerInfos = useLayerStore((s) => s.layers);
  const layerMetadata = useLayerStore((s) => s.layerMetadata);
  if (!workspaceId || !panels || panels.length === 0) return null;

  const letters = panels.map((_, i) => panelLetter(i));
  const activeIndex = panels.findIndex((p) => p.id === activeId);
  const active =
    activeIndex >= 0 ? { panel: panels[activeIndex], letter: letters[activeIndex] } : null;
  const everyLabel = letters.length === 2 ? 'Both' : 'All';
  const perPanel = mode !== 'all' && scope === 'panel' && active;
  const activeLayerId = active ? panelLayerIdOf(active.panel, viewLayers) : null;
  const activeLayerName = activeLayerId
    ? shortLayerLabel(layerInfos.find((l) => l.id === activeLayerId)?.name ?? activeLayerId)
    : null;
  // Panels thresholding the same layer differently: a neutral fact in the
  // scope line (the user chose it), not a warning banner.
  const mismatch = thresholdMismatch(panels, viewLayers, mode);
  const mismatchInfo = mismatch ? layerInfos.find((l) => l.id === mismatch.layerId) : undefined;
  const mismatchVariable = statisticVariable(
    statisticUnits(mismatchInfo?.statistic, mismatch ? layerMetadata.get(mismatch.layerId)?.dataRange : undefined),
  );
  const options = [
    ...letters.map((l) => ({ value: l, label: l, 'aria-label': `Panel ${l}` })),
    { value: '*', label: everyLabel, 'aria-label': `${everyLabel} panels` },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-bf-border-subtle px-3 py-1.5 text-bf-xs text-bf-text-secondary"
      data-testid="compare-edit-bar"
    >
      <span className="min-w-0 truncate" aria-live="polite" data-testid="compare-edit-scope">
        {perPanel
          ? `Editing: panel ${active.letter}${activeLayerName ? ` · ${activeLayerName}` : ''}`
          : 'Editing: all panels'}
      </span>
      <Select
        className="ml-auto w-auto"
        aria-label="Compare link"
        value={mode}
        options={LINK_OPTIONS}
        onValueChange={(v) =>
          useComparisonStore.getState().setLinkMode(workspaceId, v as CompareLinkMode)
        }
      />
      {mode !== 'all' ? (
        <SegmentedControl
          size="sm"
          aria-label="Inspector edits apply to"
          options={options}
          value={scope === 'all' ? '*' : (active?.letter ?? '')}
          onValueChange={(value) => {
            const store = useComparisonStore.getState();
            if (value === '*') {
              store.setEditScope(workspaceId, 'all');
              return;
            }
            const panel = panels[letters.indexOf(value)];
            if (panel) store.setActivePanel(workspaceId, panel.id);
            store.setEditScope(workspaceId, 'panel');
          }}
        />
      ) : null}
      {mismatch ? (
        <p
          className="w-full text-bf-2xs text-bf-text-muted"
          data-testid="compare-threshold-mismatch"
          role="note"
        >
          Thresholds differ:{' '}
          {mismatch.thresholds.map(({ letter, threshold }, i) => (
            <span key={letter}>
              {i > 0 ? ' · ' : ''}
              {letter}{' '}
              <ThresholdText
                line={thresholdWording(threshold, mismatchVariable) ?? 'none'}
                variable={mismatchVariable}
              />
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
