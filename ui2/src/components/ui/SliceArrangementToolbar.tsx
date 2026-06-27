/**
 * SliceArrangementToolbar — the center display toolbar for the orthogonal and
 * Integrated workspaces (Design.md §1.4: a control's one editable home is the
 * center display toolbar OR the inspector, not both).
 *
 * Controls:
 *   - Arrange — how the three slices (axial/sagittal/coronal) are laid out:
 *     Grid | Row | Column (`layoutSettingsStore.orthoArrangement`).
 *   - Split (Integrated only, `showSplit`) — orientation of the volume/surface
 *     split: Side-by-side | Stacked (`layoutSettingsStore.integratedSplit`).
 *
 * State is global (one preference for all imaging workspaces) and persisted via
 * `layoutSettingsStore`, mirroring the ComparisonWorkspace row/grid toggle.
 */

import React from "react";

import {
  useLayoutSettingsStore,
  type IntegratedSplit,
  type OrthoArrangement,
} from "@/stores/layoutSettingsStore";

export const SLICE_ARRANGEMENT_TOOLBAR_HEIGHT = 34;

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
      style={{ display: "inline-flex", gap: "2px" }}
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
              padding: "2px 8px",
              height: "22px",
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
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface SliceArrangementToolbarProps {
  /** Show the Integrated volume/surface split toggle. */
  showSplit?: boolean;
}

export const SliceArrangementToolbar: React.FC<
  SliceArrangementToolbarProps
> = ({ showSplit = false }) => {
  const arrangement = useLayoutSettingsStore((s) => s.orthoArrangement);
  const setArrangement = useLayoutSettingsStore((s) => s.setOrthoArrangement);
  const split = useLayoutSettingsStore((s) => s.integratedSplit);
  const setSplit = useLayoutSettingsStore((s) => s.setIntegratedSplit);

  const labelStyle: React.CSSProperties = {
    color: "var(--app-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "var(--app-role-section-tracking)",
    fontSize: "var(--app-role-section-size)",
  };

  return (
    <div
      data-testid="slice-arrangement-toolbar"
      className="bf-role-section"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        height: `${SLICE_ARRANGEMENT_TOOLBAR_HEIGHT}px`,
        padding: "0 8px",
        borderBottom: "1px solid var(--app-border-subtle)",
        background: "var(--app-surface-panel-raised)",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelStyle}>Arrange</span>
      <Segmented
        ariaLabel="Slice arrangement"
        options={ARRANGEMENTS}
        value={arrangement}
        onChange={setArrangement}
        testidPrefix="ortho-arrangement"
      />

      {showSplit ? (
        <>
          <span style={{ ...labelStyle, marginLeft: "8px" }}>Split</span>
          <Segmented
            ariaLabel="Integrated split orientation"
            options={SPLITS}
            value={split}
            onChange={setSplit}
            testidPrefix="integrated-split"
          />
        </>
      ) : null}
    </div>
  );
};

export default SliceArrangementToolbar;
