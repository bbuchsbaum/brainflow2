import { useEffect, useRef } from 'react';
import { useAppModeStore } from '@/stores/appModeStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStatusBarStore } from '@/stores/statusBarStore';

export function useStudioStatusBridge() {
  const appMode = useAppModeStore((state) => state.mode);
  const studioSetName = useSetStudioStore((state) => {
    const setId = state.selection.activeSetId;
    return setId ? state.sets[setId]?.name ?? 'Set Studio' : 'Set Studio';
  });
  const studioSetMemberCount = useSetStudioStore((state) => {
    const setId = state.selection.activeSetId;
    return setId ? state.sets[setId]?.memberCount ?? 0 : 0;
  });
  const studioLens = useSetStudioStore((state) => state.selection.activeLens);
  const activeMemberLabel = useSetStudioStore((state) => {
    const setId = state.selection.activeSetId;
    const memberId = state.selection.activeMemberId;
    if (!setId || !memberId) {
      return null;
    }
    const activeSet = state.sets[setId];
    const member = activeSet?.memberSummaries.find((entry) => entry.id === memberId);
    return member?.label ?? memberId;
  });
  const studioFeatureLabel = useSetStudioStore((state) => {
    const featureId = state.selection.activeFeatureId;
    return featureId ? state.features[featureId]?.label ?? '—' : '—';
  });
  const studioSourceKind = useSetStudioStore((state) => {
    const setId = state.selection.activeSetId;
    return setId ? state.sets[setId]?.sourceKind ?? null : null;
  });
  const materializationLabel = useSetStudioStore((state) => {
    const m = state.materialization;
    return `Warm ${m.warm} · Preview ${m.preview} · Pending ${m.pending}`;
  });
  const previousValuesRef = useRef<{
    coordSys?: unknown;
    crosshair?: unknown;
    mouse?: unknown;
    layer?: unknown;
    atlas?: unknown;
  } | null>(null);
  const wasStudioModeRef = useRef(false);

  useEffect(() => {
    const statusStore = useStatusBarStore.getState();

    if (appMode === 'studio') {
      if (!wasStudioModeRef.current) {
        previousValuesRef.current = {
          coordSys: statusStore.values.coordSys,
          crosshair: statusStore.values.crosshair,
          mouse: statusStore.values.mouse,
          layer: statusStore.values.layer,
          atlas: statusStore.values.atlas,
        };
        wasStudioModeRef.current = true;
      }

      statusStore.setBatch([
        ['coordSys', 'Studio'],
        ['crosshair', studioSetName],
        ['mouse', `${studioLens === 'deck' ? 'Browse' : 'Compare'} · ${studioSetMemberCount} members${activeMemberLabel ? ` · ${activeMemberLabel}` : ''}`],
        ['layer', `Feature ${studioFeatureLabel}`],
        ['atlas', `${studioSourceKind === 'demo' ? 'Demo' : 'Imported'} · ${materializationLabel}`],
      ]);
      return;
    }

    if (!wasStudioModeRef.current) {
      return;
    }

    const previousValues = previousValuesRef.current;
    statusStore.setBatch([
      ['coordSys', (previousValues?.coordSys as string | undefined) ?? 'LPI'],
      ['crosshair', (previousValues?.crosshair as string | undefined) ?? '(0.0, 0.0, 0.0)'],
      ['mouse', (previousValues?.mouse as string | undefined) ?? '--'],
      ['layer', (previousValues?.layer as string | undefined) ?? 'None'],
      ['atlas', (previousValues?.atlas as string | undefined) ?? 'Atlas --/--'],
    ]);
    wasStudioModeRef.current = false;
    previousValuesRef.current = null;
  }, [
    appMode,
    materializationLabel,
    activeMemberLabel,
    studioFeatureLabel,
    studioLens,
    studioSetMemberCount,
    studioSetName,
    studioSourceKind,
  ]);
}
