/**
 * The first screen's quiet hint over the default view (qa-features-2026-10-31
 * §7): "Drop a map here" over the MNI T1 until the first load, or a status
 * line while the T1 downloads in the background. It never takes the pointer,
 * so drops and clicks reach the view underneath.
 */

import React from 'react';

import { useFirstScreenStore } from '@/services/firstScreenService';
import { useLayerStore } from '@/stores/layerStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';

export const FirstScreenHint: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const phase = useFirstScreenStore((s) => (s.workspaceId === workspaceId ? s.phase : 'idle'));
  const templateLayerIds = useFirstScreenStore((s) => s.templateLayerIds);
  const layers = useLayerStore((s) => s.layers);
  // The user's own load (queued, reading, or a layer already in): the
  // background download no longer matters to them (review M3).
  const userLoading = useLoadingQueueStore((s) => s.activeLoads.size > 0 || s.queue.length > 0);
  const layerLoading = useLayerStore((s) => s.loadingLayers.size > 0);

  // The first load (or removing the template) ends the first screen.
  React.useEffect(() => {
    if (phase !== 'shown') return;
    const ids = layers.map((layer) => layer.id);
    const changed =
      ids.some((id) => !templateLayerIds.includes(id)) ||
      templateLayerIds.some((id) => !ids.includes(id));
    if (changed) useFirstScreenStore.getState().setPhase('done');
  }, [phase, layers, templateLayerIds]);

  const message =
    phase === 'shown'
      ? 'Drop a map here'
      : phase === 'downloading' && layers.length === 0 && !userLoading && !layerLoading
        ? 'Downloading the MNI template in the background…'
        : null;
  if (!message) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-6 z-[6] flex justify-center"
      data-testid="first-screen-hint"
      data-phase={phase}
      role="status"
    >
      <span className="rounded-sm border border-bf-border-subtle bg-bf-bg-panel px-3 py-1 text-bf-sm text-bf-text-secondary">
        {message}
      </span>
    </div>
  );
};
