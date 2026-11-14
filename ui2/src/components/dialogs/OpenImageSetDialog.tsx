import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Loader2, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Checkbox, FilterChip, Notice, TextField } from '@/components/ui/bf';
import { useImageSetStore } from '@/stores/imageSetStore';
import { folderName, getImageSetService } from '@/services/ImageSetService';
import { describeKindGrouping, groupImagesByKind } from '@/utils/imageSetKinds';
import { parseNameFilter } from '@/utils/nameFilter';
import type { ImageSetPreview } from '@/types/imageSet';

export function OpenImageSetDialog() {
  const preview = useImageSetStore((state) => state.preview);
  if (!preview) return null;
  return createPortal(
    <Modal
      isOpen
      title="Open folder as image set"
      size="xl"
      onClose={() => getImageSetService().closePreview()}
    >
      {preview.loading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-bf-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading folder…
        </div>
      ) : (
        <ImageSetChecklist key={preview.id} preview={preview} />
      )}
    </Modal>,
    document.body,
  );
}

const plural = (count: number) => `${count} ${count === 1 ? 'image' : 'images'}`;

function ImageSetChecklist({ preview }: { preview: ImageSetPreview }) {
  const { members } = preview;
  const folder = folderName(preview.folder);
  const grouping = useMemo(() => groupImagesByKind(members), [members]);
  const kindByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of grouping?.groups ?? []) for (const path of group.paths) map.set(path, group.key);
    return map;
  }, [grouping]);

  const [selected, setSelected] = useState(() => {
    const all = members.map((member) => member.path);
    if (!preview.initialSelected) return new Set(all);
    const wanted = new Set(preview.initialSelected);
    return new Set(all.filter((path) => wanted.has(path)));
  });
  // Start from the caller's filter text only if it shows exactly its selection.
  const [query, setQuery] = useState(() => {
    const text = preview.initialQuery?.trim();
    if (!text || !preview.initialSelected) return '';
    const filter = parseNameFilter(text);
    const shown = members.filter((member) => filter.matches(member.name));
    return shown.length === selected.size && shown.every((member) => selected.has(member.path))
      ? text
      : '';
  });
  const [pressed, setPressed] = useState<string[]>([]);
  /** The selection before the first chip was pressed; restored when the last is released. */
  const beforeChips = useRef<Set<string> | null>(null);
  /** Rows were checked or cleared by hand since the first chip was pressed. */
  const editedUnderChips = useRef(false);
  const [editedName, setEditedName] = useState<string | null>(null);

  const filter = useMemo(() => parseNameFilter(query), [query]);
  const visible = useMemo(
    () =>
      members.filter(
        (member) =>
          filter.matches(member.name) &&
          (pressed.length === 0 || pressed.includes(kindByPath.get(member.path) ?? '')),
      ),
    [members, filter, pressed, kindByPath],
  );
  const pressedLabels = (grouping?.groups ?? [])
    .filter((group) => pressed.includes(group.key))
    .map((group) => group.label);
  const name = editedName ?? (pressedLabels.length ? `${folder} · ${pressedLabels.join(', ')}` : folder);

  const toggleKind = (key: string, on: boolean) => {
    const next = on ? [...pressed, key] : pressed.filter((entry) => entry !== key);
    const ofKind = (path: string) => kindByPath.get(path) === key;
    setPressed(next);
    if (pressed.length === 0) {
      // First chip: exactly its images that the typed filter also shows.
      beforeChips.current = selected;
      editedUnderChips.current = false;
      setSelected(
        new Set(
          members
            .filter((member) => ofKind(member.path) && filter.matches(member.name))
            .map((member) => member.path),
        ),
      );
    } else if (next.length === 0) {
      // Last chip released: back to the earlier selection, unless rows were
      // changed by hand meanwhile; that work is kept.
      if (beforeChips.current && !editedUnderChips.current) setSelected(beforeChips.current);
      beforeChips.current = null;
    } else {
      // A further chip adds or removes only its own images, so hand edits
      // to the other kinds survive.
      setSelected((old) => {
        const result = new Set(old);
        for (const member of members) {
          if (!ofKind(member.path)) continue;
          if (on && filter.matches(member.name)) result.add(member.path);
          if (!on) result.delete(member.path);
        }
        return result;
      });
    }
  };
  const edit = (change: (next: Set<string>) => void) => {
    editedUnderChips.current = true;
    setSelected((old) => {
      const next = new Set(old);
      change(next);
      return next;
    });
  };
  const setShown = (on: boolean) =>
    edit((next) => {
      for (const member of visible) {
        if (on) next.add(member.path);
        else next.delete(member.path);
      }
    });
  const keepOnlyShown = () =>
    edit((next) => {
      const shown = new Set(visible.map((member) => member.path));
      for (const path of [...next]) if (!shown.has(path)) next.delete(path);
    });
  const toggle = (path: string) =>
    edit((next) => {
      if (next.has(path)) next.delete(path);
      else next.add(path);
    });

  const narrowed = visible.length < members.length;
  const shownSelected = visible.filter((member) => selected.has(member.path)).length;
  const hiddenSelected = selected.size - shownSelected;
  const countLine = narrowed
    ? `Showing ${visible.length} of ${members.length} · ${selected.size} selected${
        hiddenSelected ? `, ${hiddenSelected} not shown` : selected.size ? ', none hidden' : ''
      }`
    : `${plural(members.length)} · ${selected.size} selected`;

  return (
    <div className="flex flex-col gap-3 text-bf-sm">
      <div className="flex flex-col gap-1">
        <p className="break-all font-mono text-bf-xs text-bf-text-muted">{preview.folder}</p>
        <p className="text-bf-xs text-bf-text-muted">
          Choose images for one layer, from this folder only. Switch between them in the Inspector.
        </p>
      </div>
      {members.length > 0 ? (
        <>
          {grouping && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span id="image-set-kinds" className="text-bf-xs font-medium text-bf-text-secondary">
                  Kind
                </span>
                <span className="text-bf-xs text-bf-text-muted">
                  From the file names · {describeKindGrouping(grouping)}
                </span>
              </div>
              <div role="group" aria-labelledby="image-set-kinds" className="flex flex-wrap gap-1.5">
                {grouping.groups.map((group) => (
                  <FilterChip
                    key={group.key}
                    pressed={pressed.includes(group.key)}
                    count={group.paths.length}
                    disabled={preview.opening}
                    className={group.other ? undefined : 'font-mono'}
                    onPressedChange={(on) => toggleKind(group.key, on)}
                  >
                    {group.label}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-bf-text-secondary"
              />
              <TextField
                aria-label="Filter images"
                placeholder="Filter by name, for example cue -probe"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-6"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={preview.opening || shownSelected === visible.length}
              onClick={() => setShown(true)}
            >
              {narrowed ? 'Select shown' : 'Select all'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={preview.opening || shownSelected === 0}
              onClick={() => setShown(false)}
            >
              {narrowed ? 'Clear shown' : 'Clear all'}
            </Button>
          </div>
          <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
            <p role="status" className="text-bf-xs text-bf-text-secondary">
              {countLine}
            </p>
            {hiddenSelected > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={preview.opening}
                onClick={keepOnlyShown}
              >
                Deselect the {hiddenSelected} not shown
              </Button>
            )}
          </div>
          {/* Fixed height: the chips and buttons above stay put as the list narrows. */}
          <div
            role="group"
            className="h-[40vh] overflow-y-auto rounded-sm border border-bf-border bg-bf-bg-panel"
            aria-label="Images in folder"
          >
            {visible.map((member) => (
              <Checkbox
                key={member.path}
                checked={selected.has(member.path)}
                disabled={preview.opening}
                onCheckedChange={() => toggle(member.path)}
                className="flex w-full border-b border-bf-border-subtle px-2 py-0.5 last:border-0 hover:bg-bf-bg-hover"
              >
                <span className="break-all font-mono text-bf-xs">{member.name}</span>
              </Checkbox>
            ))}
            {!visible.length && (
              <p className="p-3 text-bf-xs text-bf-text-muted">
                No images match. Change the filter or release a kind.
              </p>
            )}
          </div>
        </>
      ) : (
        !preview.error && (
          <p className="rounded-sm border border-bf-border p-3 text-bf-text-muted">
            No NIfTI images in this folder. Open a folder containing .nii or .nii.gz files.
          </p>
        )
      )}
      {preview.error && (
        <Notice severity="danger" role="alert" className="break-words">
          {preview.error}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bf-border pt-3">
        <label className="mr-auto flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-bf-xs font-medium text-bf-text-secondary">Set name</span>
          <TextField
            value={name}
            onChange={(event) => setEditedName(event.target.value)}
            disabled={preview.opening}
            className="w-56"
          />
        </label>
        <Button variant="secondary" size="sm" onClick={() => getImageSetService().closePreview()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!selected.size || preview.opening}
          icon={
            preview.opening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="h-3.5 w-3.5" />
            )
          }
          onClick={() =>
            void getImageSetService().confirmPreview(
              members.filter((member) => selected.has(member.path)).map((member) => member.path),
              name,
            )
          }
        >
          {preview.opening ? 'Opening first image…' : `Open ${plural(selected.size)}`}
        </Button>
      </div>
    </div>
  );
}
