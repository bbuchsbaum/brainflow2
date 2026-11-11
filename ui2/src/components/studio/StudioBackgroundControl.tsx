import { useEffect, useMemo, useState } from 'react';
import { Select, ToolbarField } from '@/components/ui/bf';
import { getTemplateService } from '@/services/TemplateService';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import {
  loadStudioBackgroundOptions,
  selectStudioBackgroundNote,
  selectStudioBackgroundPath,
  withCurrentBackground,
  type StudioBackgroundOption,
} from '@/services/studio/studioBackground';
import { useSetStudioStore } from '@/stores/setStudioStore';

/**
 * The active set's background: the anatomy template drawn beneath its
 * images in the Deck, Compare and Population lenses. Its one editable home,
 * in the Studio toolbar beside the lens switcher.
 */
export function StudioBackgroundControl() {
  const sourcePath = useSetStudioStore(selectStudioBackgroundPath);
  const note = useSetStudioStore(selectStudioBackgroundNote);
  const issue = useSetStudioStore((state) =>
    state.studioBackgroundIssue && state.studioBackgroundIssue.sourcePath === sourcePath
      ? state.studioBackgroundIssue.message
      : null,
  );

  const [catalog, setCatalog] = useState<StudioBackgroundOption[]>([]);
  useEffect(() => {
    let alive = true;
    loadStudioBackgroundOptions(() => getTemplateService().getTemplateCatalog()).then(
      (options) => {
        if (alive) setCatalog(options);
      },
      (error) => {
        console.warn('[StudioBackgroundControl] Template catalog unavailable:', error);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const options = useMemo(() => withCurrentBackground(catalog, sourcePath), [catalog, sourcePath]);

  return (
    <>
      <ToolbarField label="Background" error={issue ?? undefined} className="min-w-0 max-w-full">
        <Select
          className="w-auto min-w-0 max-w-[12rem]"
          value={sourcePath ?? ''}
          title={note ?? 'Anatomy drawn beneath the images'}
          onValueChange={(value) => getStudioCoordinationService().chooseBackground(value || null)}
        >
          <option value="">None</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </ToolbarField>
      {note ? (
        // A row of its own under the controls, across the toolbar's width,
        // on up to two lines: readable without hovering.
        <span
          className="order-last line-clamp-2 min-w-0 basis-full text-bf-xs text-muted-foreground"
          title={note}
          data-testid="studio-background-note"
        >
          {note}
        </span>
      ) : null}
    </>
  );
}
