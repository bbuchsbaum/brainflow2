import React from "react";
import type { SceneItem, SceneItemKind } from "@/types/sceneItem";

interface SceneStackItemProps {
  item: SceneItem;
  selected: boolean;
  onSelect: () => void;
  /**
   * Optional drag handle, rendered before the kind glyph. Provided by the
   * sortable wrapper for reorderable groups; omitted for static groups. The
   * row is a `<div role="button">` (not a `<button>`) precisely so this nested
   * handle button is valid markup.
   */
  dragHandle?: React.ReactNode;
}

const GLYPH_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Three stacked slices — a volume. */
function VolumeGlyph({ overlay = false }: { overlay?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <path
        d="M2 5.5l6-3 6 3-6 3z"
        fill={overlay ? "currentColor" : "none"}
        fillOpacity={overlay ? 0.35 : undefined}
      />
      <path d="M2 8.5l6 3 6-3" />
      <path d="M2 11.5l6 3 6-3" />
    </svg>
  );
}

/** A 2×2 parcellation grid — a label atlas. */
function AtlasGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" />
      <rect x="9" y="9" width="4.5" height="4.5" />
    </svg>
  );
}

/** A triangle mesh — a surface. */
function SurfaceGlyph({ overlay = false }: { overlay?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M2 12L8 3l6 9z" />
      <path
        d="M5 12L8 7.5 11 12z"
        fill={overlay ? "currentColor" : "none"}
        fillOpacity={overlay ? 0.35 : undefined}
      />
      <path d="M8 3v4.5" />
    </svg>
  );
}

/** An arrow onto a surface — a volume-to-surface mapping. */
function MappingGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M2.5 8h8" />
      <path d="M7.5 5l3 3-3 3" />
      <path d="M13.5 3v10" />
    </svg>
  );
}

/**
 * Kind glyphs are neutral (the row subtitle already spells the kind out), so
 * the only colour in the list is the amber selection bar.
 */
const KIND_GLYPH: Record<SceneItemKind, React.ReactNode> = {
  "volume-base": <VolumeGlyph />,
  "volume-overlay": <VolumeGlyph overlay />,
  "volume-overlay-atlas": <AtlasGlyph />,
  "surface-geometry": <SurfaceGlyph />,
  "surface-overlay": <SurfaceGlyph overlay />,
  mapping: <MappingGlyph />,
};

export function SceneStackItem({
  item,
  selected,
  onSelect,
  dragHandle,
}: SceneStackItemProps) {
  const opacityPct = Math.round(item.opacity * 100);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-pressed={selected}
      // Selection = selected fill + 2px accent leading edge; focus = a
      // separate 2px ring with a 1px offset (HYBRID rule 4). Tailwind's ring
      // composes with the inset edge shadow, so both show when both apply.
      className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        selected
          ? "bg-bf-bg-selected shadow-[inset_2px_0_0_var(--bf-accent)]"
          : "hover:bg-accent"
      }`}
    >
      {dragHandle}
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: "var(--bf-text-secondary)" }}
      >
        {KIND_GLYPH[item.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-bf-sm text-foreground">
          {item.name}
        </span>
        <span className="block truncate text-bf-xs text-muted-foreground">
          {item.subtitle}
        </span>
      </span>
      <span
        className="shrink-0 font-mono text-bf-xs tabular-nums text-muted-foreground"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {opacityPct}%
      </span>
    </div>
  );
}
