import React from 'react';
import { ChevronLeft, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { useLayerStore } from '@/stores/layerStore';
import { useImageSetStore } from '@/stores/imageSetStore';
import { getImageSetService } from '@/services/ImageSetService';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection } from '../InspectorSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

export function ImageSetSection({ item }: { item: SceneItem }) {
  const setId = useLayerStore(
    (state) => state.layers.find((layer) => layer.id === item.id)?.imageSetId,
  );
  const entry = useImageSetStore((state) => (setId ? state.sets[setId] : undefined));
  if (!entry) return null;
  const index = entry.pendingIndex ?? entry.activeIndex;
  const busy = entry.pendingIndex !== null;
  const select = (next: number) => void getImageSetService().selectMember(entry.id, next);
  const button =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border hover:bg-accent/40 disabled:opacity-30';
  return (
    <InspectorSection
      label="Image set"
      icon={<Layers className="h-3.5 w-3.5" />}
      meta={`${entry.activeIndex + 1} / ${entry.members.length}`}
    >
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous image"
            className={button}
            disabled={index <= 0}
            onClick={() => select(index - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <Select value={String(index)} onValueChange={(value) => select(Number(value))}>
              <SelectTrigger aria-label="Image in set" className="h-7 min-w-0 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-w-[min(38rem,90vw)]">
                {entry.members.map((member, memberIndex) => (
                  <SelectItem
                    key={member.path}
                    value={String(memberIndex)}
                    textValue={member.name}
                    className="text-xs"
                  >
                    <span className="break-all">{member.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            aria-label="Next image"
            className={button}
            disabled={index >= entry.members.length - 1}
            onClick={() => select(index + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="break-all font-mono text-[11px] leading-4 text-muted-foreground">
          {entry.members[entry.activeIndex]?.name}
        </p>
        {busy ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Opening {entry.members[index].name}…
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            One image visible · Contrast remembered per image
          </p>
        )}
        {entry.error && (
          <p role="alert" className="break-words text-xs text-destructive">
            {entry.error}
          </p>
        )}
      </div>
    </InspectorSection>
  );
}
