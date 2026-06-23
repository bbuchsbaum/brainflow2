/**
 * ArrangementMenu — a compact corner control for the orthogonal / Integrated
 * center layout. A single layout icon (overlaid in the view's top-right corner)
 * opens a popover with:
 *   - Arrange — Grid | Row | Column (`layoutSettingsStore.orthoArrangement`).
 *   - Split (Integrated only, `showSplit`) — Side-by-side | Stacked
 *     (`layoutSettingsStore.integratedSplit`).
 *
 * Replaces the earlier full-width toolbar so the control adds (almost) no
 * persistent clutter (Design.md §1.4 — one editable home, here the center
 * display). State is global and persisted via `layoutSettingsStore`.
 */

import React from "react";
import { LayoutGrid } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";
import {
  useLayoutSettingsStore,
  type IntegratedSplit,
  type OrthoArrangement,
} from "@/stores/layoutSettingsStore";

const ARRANGEMENTS: ReadonlyArray<{ id: OrthoArrangement; label: string }> = [
  { id: "grid", label: "Grid" },
  { id: "row", label: "Row" },
  { id: "column", label: "Column" },
];

const SPLITS: ReadonlyArray<{ id: IntegratedSplit; label: string }> = [
  { id: "horizontal", label: "Side-by-side" },
  { id: "vertical", label: "Stacked" },
];

interface SegmentedProps<T extends string> {
  ariaLabel: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  testidPrefix: string;
}

function Segmented<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  testidPrefix,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: "flex", gap: "2px" }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testidPrefix}-${opt.id}`}
            data-active={active ? "true" : "false"}
            onClick={() => onChange(opt.id)}
            className="bf-role-section"
            style={{
              appearance: "none",
              flex: "1 1 auto",
              padding: "3px 8px",
              border: "1px solid",
              borderColor: active
                ? "var(--app-border-active)"
                : "var(--app-border)",
              background: active ? "var(--app-bg-active)" : "transparent",
              color: active
                ? "var(--app-text-primary)"
                : "var(--app-text-muted)",
              cursor: "pointer",
              borderRadius: "var(--app-radius-sm)",
              fontSize: "var(--app-role-section-size)",
              letterSpacing: "var(--app-role-section-tracking)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface ArrangementMenuProps {
  /** Show the Integrated volume/surface split toggle. */
  showSplit?: boolean;
  className?: string;
}

export const ArrangementMenu: React.FC<ArrangementMenuProps> = ({
  showSplit = false,
  className,
}) => {
  const arrangement = useLayoutSettingsStore((s) => s.orthoArrangement);
  const setArrangement = useLayoutSettingsStore((s) => s.setOrthoArrangement);
  const split = useLayoutSettingsStore((s) => s.integratedSplit);
  const setSplit = useLayoutSettingsStore((s) => s.setIntegratedSplit);

  const labelStyle: React.CSSProperties = {
    color: "var(--app-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "var(--app-role-section-tracking)",
    fontSize: "var(--app-role-section-size)",
    marginBottom: "4px",
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Layout arrangement"
          title="Layout arrangement"
          data-testid="arrangement-menu-trigger"
          className={className}
          style={{
            appearance: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: "26px",
            width: "26px",
            border: "1px solid var(--app-border)",
            background:
              "color-mix(in srgb, var(--app-bg-primary) 70%, transparent)",
            color: "var(--app-text-muted)",
            cursor: "pointer",
            borderRadius: "var(--app-radius-sm)",
            backdropFilter: "blur(2px)",
          }}
        >
          <LayoutGrid width={14} height={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-auto p-2"
        data-testid="arrangement-menu-content"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <div style={labelStyle}>Arrange</div>
            <Segmented
              ariaLabel="Slice arrangement"
              options={ARRANGEMENTS}
              value={arrangement}
              onChange={setArrangement}
              testidPrefix="ortho-arrangement"
            />
          </div>

          {showSplit ? (
            <div>
              <div style={labelStyle}>Split</div>
              <Segmented
                ariaLabel="Integrated split orientation"
                options={SPLITS}
                value={split}
                onChange={setSplit}
                testidPrefix="integrated-split"
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ArrangementMenu;
