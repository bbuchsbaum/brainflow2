import React from 'react';

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
  if (!open) return null;
  return (
    <div
      role="menu"
      aria-label="Load"
      className="absolute right-2 top-12 z-30 min-w-[220px] overflow-hidden rounded-md border border-border bg-card shadow-lg"
      onMouseLeave={onClose}
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
