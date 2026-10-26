import React from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { useLayerStore } from '@/stores/layerStore';
import { useImageSetStore } from '@/stores/imageSetStore';
import { getImageSetService } from '@/services/ImageSetService';
import type { SceneItem } from '@/types/sceneItem';
import { Notice, Pager, Section, Select } from '@/components/ui/bf';

export function ImageSetSection({ item }: { item: SceneItem }) {
  const setId = useLayerStore(
    (state) => state.layers.find((layer) => layer.id === item.id)?.imageSetId,
  );
  const entry = useImageSetStore((state) => (setId ? state.sets[setId] : undefined));
  if (!entry) return null;
  const index = entry.pendingIndex ?? entry.activeIndex;
  const busy = entry.pendingIndex !== null;
  const select = (next: number) => void getImageSetService().selectMember(entry.id, next);
  return (
    <Section
      title="Image set"
      icon={<Layers className="h-3.5 w-3.5" />}
      meta={`${entry.activeIndex + 1} / ${entry.members.length}`}
    >
      <div className="space-y-2 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          <Pager
            noun="image"
            page={index + 1}
            count={entry.members.length}
            onPageChange={(page) => select(page - 1)}
          />
          <Select
            aria-label="Image in set"
            value={String(index)}
            onValueChange={(value) => select(Number(value))}
            className="min-w-0 flex-1"
            options={entry.members.map((member, memberIndex) => ({
              value: String(memberIndex),
              label: member.name,
            }))}
          />
        </div>
        <p className="break-all font-mono text-bf-xs leading-4 text-muted-foreground">
          {entry.members[entry.activeIndex]?.name}
        </p>
        {busy ? (
          <Notice icon={<Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}>
            Opening {entry.members[index].name}…
          </Notice>
        ) : (
          <p className="text-bf-xs text-muted-foreground">
            One image visible · Contrast remembered per image
          </p>
        )}
        {entry.error && (
          <Notice severity="danger" role="alert" className="break-words">
            {entry.error}
          </Notice>
        )}
      </div>
    </Section>
  );
}
