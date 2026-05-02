import React from 'react';
import { useSceneStack } from '@/hooks/useSceneStack';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection } from './InspectorSection';
import { SceneStackItem } from './SceneStackItem';

/**
 * Scene section of the imaging Inspector. Three subgroups:
 *   - VOLUME VIEW
 *   - SURFACE VIEW   (rendered only when surfaces are loaded)
 *   - MAPPINGS       (rendered only when vol→surf mappings exist)
 *
 * Empty surface and mapping groups are hidden — discoverability moves to
 * the `+ Load` sheet in the Inspector header so the rail isn't permanent
 * empty-state noise. Volume View is always rendered (a Brainflow session
 * is volume-first; if there are zero volumes the user is on a brand-new
 * canvas and the empty placeholder serves as the obvious next-action).
 */
export function SceneStack() {
  const { volumes, surfaces, mappings } = useSceneStack();
  const activeItemId = useInspectorSelectionStore((state) => state.activeItemId);
  const setActive = useInspectorSelectionStore((state) => state.setActive);

  const summary = buildSummary(volumes, surfaces, mappings);

  return (
    <InspectorSection
      label="Scene"
      icon={<SceneIcon />}
      defaultOpen
      meta={summary}
    >
      <SceneGroup
        title="Volume View"
        items={volumes}
        emptyHint="No volumes loaded — use + Load"
        showWhenEmpty
        activeItemId={activeItemId}
        onSelect={setActive}
      />
      <SceneGroup
        title="Surface View"
        items={surfaces}
        emptyHint="No surfaces loaded"
        showWhenEmpty={false}
        activeItemId={activeItemId}
        onSelect={setActive}
      />
      <SceneGroup
        title="Mappings"
        items={mappings}
        emptyHint="No vol-to-surface mappings yet"
        showWhenEmpty={false}
        activeItemId={activeItemId}
        onSelect={setActive}
      />
    </InspectorSection>
  );
}

function SceneGroup({
  title,
  items,
  emptyHint,
  showWhenEmpty,
  activeItemId,
  onSelect,
}: {
  title: string;
  items: SceneItem[];
  emptyHint: string;
  showWhenEmpty: boolean;
  activeItemId: string | null;
  onSelect: (item: SceneItem) => void;
}) {
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-card/30 px-3 py-2 text-[11px] text-muted-foreground/70">
          {emptyHint}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <SceneStackItem
              key={item.id}
              item={item}
              selected={item.id === activeItemId}
              onSelect={() => onSelect(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact section meta line, e.g. "2 items · volume" or "5 items · mixed".
 * Renders to the right of the SCENE header, before the chevron.
 */
function buildSummary(
  volumes: SceneItem[],
  surfaces: SceneItem[],
  mappings: SceneItem[]
): string | null {
  const total = volumes.length + surfaces.length + mappings.length;
  if (total === 0) return null;

  const kinds: string[] = [];
  if (volumes.length > 0) kinds.push('volume');
  if (surfaces.length > 0) kinds.push('surface');
  if (mappings.length > 0) kinds.push('mapping');
  const kindLabel = kinds.length === 1 ? kinds[0] : 'mixed';

  return `${total} item${total === 1 ? '' : 's'} · ${kindLabel}`;
}

function SceneIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="3" rx="0.5" />
      <rect x="2" y="7" width="12" height="3" rx="0.5" />
      <rect x="2" y="11" width="12" height="2.5" rx="0.5" />
    </svg>
  );
}
