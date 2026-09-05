import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Loader2, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useImageSetStore } from '@/stores/imageSetStore';
import { folderName, getImageSetService } from '@/services/ImageSetService';
import type { ImageSetPreview } from '@/types/imageSet';

const button =
  'rounded border border-border px-3 py-1.5 text-xs hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40';

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
        <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading folder…
        </div>
      ) : (
        <ImageSetChecklist key={preview.id} preview={preview} />
      )}
    </Modal>,
    document.body,
  );
}

function ImageSetChecklist({ preview }: { preview: ImageSetPreview }) {
  const [name, setName] = useState(() => folderName(preview.folder));
  const [selected, setSelected] = useState(
    () => new Set(preview.members.map((member) => member.path)),
  );
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      preview.members.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())),
    [preview.members, query],
  );
  const toggle = (path: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <p className="break-all font-mono text-xs text-muted-foreground">{preview.folder}</p>
        <p className="text-xs text-muted-foreground">
          Choose images for one layer. Switch between them in the Inspector.
        </p>
      </div>
      <label className="block space-y-1.5 text-xs font-medium">
        <span>Set name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={preview.opening}
          className="w-full rounded border border-border bg-[var(--bf-bg-input)] px-2.5 py-2 font-normal"
        />
      </label>
      {preview.members.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                aria-label="Filter images"
                placeholder="Filter images…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded border border-border bg-[var(--bf-bg-input)] py-1.5 pl-7 pr-2 text-xs"
              />
            </label>
            <button
              type="button"
              className={button}
              disabled={preview.opening}
              onClick={() => setSelected(new Set(preview.members.map((member) => member.path)))}
            >
              All
            </button>
            <button
              type="button"
              className={button}
              disabled={preview.opening}
              onClick={() => setSelected(new Set())}
            >
              None
            </button>
          </div>
          <div
            className="max-h-[40vh] overflow-y-auto rounded border border-border"
            aria-label="Images in folder"
          >
            {visible.map((member) => (
              <label
                key={member.path}
                className="flex cursor-pointer items-start gap-2.5 border-b border-border/40 px-3 py-2.5 last:border-0 hover:bg-accent/20"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={selected.has(member.path)}
                  disabled={preview.opening}
                  onChange={() => toggle(member.path)}
                />
                <span className="min-w-0 break-all font-mono text-xs leading-5">{member.name}</span>
              </label>
            ))}
            {!visible.length && (
              <p className="p-4 text-xs text-muted-foreground">No images match this filter.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.size} of {preview.members.length} images selected · This folder only
          </p>
        </>
      ) : (
        !preview.error && (
          <p className="rounded border border-border p-4 text-muted-foreground">
            No NIfTI images in this folder. Open a folder containing .nii or .nii.gz files.
          </p>
        )
      )}
      {preview.error && (
        <p
          role="alert"
          className="break-words rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {preview.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          className={button}
          onClick={() => getImageSetService().closePreview()}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${button} flex items-center gap-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/90`}
          disabled={!selected.size || preview.opening}
          onClick={() => void getImageSetService().confirmPreview([...selected], name)}
        >
          {preview.opening ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Layers className="h-3.5 w-3.5" />
          )}
          {preview.opening ? 'Opening first image…' : `Open image set (${selected.size})`}
        </button>
      </div>
    </div>
  );
}
