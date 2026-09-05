import React, { useEffect, useRef } from 'react';

interface LoadSheetProps {
  open: boolean;
  onClose: () => void;
  onLoadVolume: () => void;
  onLoadSurface: () => void;
  onLoadAtlas: () => void;
  onProjectVolumeToSurface: () => void;
}

/**
 * Popover sheet anchored under the `+ Load` button. Four entries cover
 * the mockup's discoverability story: Volume, Surface, Atlas, and Project
 * volume-to-surface (the only place a vol2surf mapping gets created from
 * the inspector). Loaded atlases appear as `volume-overlay-atlas` scene
 * items — there is intentionally no separate atlas catalog sidebar.
 */
export function LoadSheet({
  open,
  onClose,
  onLoadVolume,
  onLoadSurface,
  onLoadAtlas,
  onProjectVolumeToSurface,
}: LoadSheetProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Load"
      className="absolute right-2 top-12 z-30 min-w-[220px] overflow-hidden rounded-md border border-border bg-card shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          onClose();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <SheetItem
        label="Load volume…"
        hint="NIfTI"
        onClick={() => {
          onLoadVolume();
          onClose();
        }}
      />
      <SheetItem
        label="Load surface…"
        hint="GIfTI mesh"
        onClick={() => {
          onLoadSurface();
          onClose();
        }}
      />
      <SheetItem
        label="Load atlas…"
        hint="parcellation / labels"
        onClick={() => {
          onLoadAtlas();
          onClose();
        }}
      />
      <SheetDivider />
      <SheetItem
        label="Project volume to surface…"
        hint="vol2surf mapping"
        onClick={() => {
          onProjectVolumeToSurface();
          onClose();
        }}
      />
    </div>
  );
}

function SheetItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span className="text-foreground">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}

function SheetDivider() {
  return <div aria-hidden className="h-px bg-border/60" />;
}
