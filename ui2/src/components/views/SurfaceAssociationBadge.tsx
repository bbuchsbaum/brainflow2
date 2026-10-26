/**
 * SurfaceAssociationBadge — Phase 5c of the integrated workspace refactor.
 *
 * Renders inside the integrated workspace's surface region as a small
 * absolutely-positioned banner that surfaces the current surface ↔ volume
 * relationship. Three states (driven by `useSurfaceAssociationState`):
 *
 *   missing         → "No surface loaded" with a "Load surface…" CTA.
 *   loaded-unlinked → warning-toned unlinked indicator + the reason.
 *   loaded-linked   → quiet linked indicator naming the source volume.
 *
 * Colour policy: the unlinked state and the pial/white coordinate-linking
 * caveat are warnings (`--bf-warning`). The template note is neutral guidance; the linked
 * state carries `--bf-success` on its icon only. Amber is reserved for the
 * accent, so none of these states use it.
 *
 * The badge is **non-blocking** — it sits in the top-left of the surface
 * canvas at low opacity until hovered. Surface canvas interactions
 * continue to work behind it (pointer-events on the inner card only).
 */

import React, { useMemo } from "react";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { collectRenderSurfaces } from "./surfaceRenderSurfaces";
import { resolveCursorAnatomy } from "./surfaceLink";
import { Brain, Link, Link2Off } from "lucide-react";

import { useSurfaceAssociationState } from "./surfaceAssociation.helpers";

const ABS_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "8px",
  left: "8px",
  zIndex: 4,
  pointerEvents: "none",
  display: "flex",
};

// Inline: the badge is the surface pane's top-margin status strip. It sits
// over the pane's top 28px (the surface panel keeps the full pane so its
// camera framing is unchanged) and has no fill: HYBRID status rule, a
// warning reads as icon + hairline edge + text, never as a filled chip.
const INLINE_STRIP_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: "44px",
  height: "28px",
  zIndex: 4,
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  minWidth: 0,
};

/** Unfilled status line: hairline edge in the state colour, neutral text. */
function inlineStatusStyle(edge: string): React.CSSProperties {
  return {
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    height: "16px",
    padding: "0 0 0 6px",
    background: "transparent",
    border: "none",
    borderLeft: `1px solid ${edge}`,
    borderRadius: 0,
    color: "var(--bf-text-secondary)",
    fontSize: "var(--bf-text-xs)",
    fontWeight: 450,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
    maxWidth: "100%",
  };
}

const DETAIL_STYLE: React.CSSProperties = {
  color: "var(--bf-text-muted)",
  fontWeight: 450,
};

const CARD_BASE_STYLE: React.CSSProperties = {
  pointerEvents: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 8px",
  height: "22px",
  background: "hsl(var(--card) / 0.92)",
  border: "1px solid var(--bf-border)",
  borderRadius: "var(--bf-radius-sm)",
  color: "var(--bf-text-secondary)",
  fontSize: "var(--bf-text-xs)",
  fontWeight: 500,
  backdropFilter: "blur(6px)",
  whiteSpace: "nowrap",
  maxWidth: "320px",
};

// Coordinate-linking caveat: a scientific caution, so it uses the warning
// token (text/icon, soft fill, hairline border) rather than neutral grey or
// the amber selection accent.
const CAVEAT_STYLE: React.CSSProperties = {
  ...CARD_BASE_STYLE,
  color: "var(--bf-warning)",
  background: "var(--bf-warning-soft)",
  border: "1px solid color-mix(in srgb, var(--bf-warning) 40%, transparent)",
};

export const SurfaceAssociationBadge: React.FC<{
  /** Render as a top-margin strip instead of an overlay on the canvas. */
  inline?: boolean;
}> = ({ inline = false }) => {
  const wrapperStyle = inline ? INLINE_STRIP_STYLE : ABS_OVERLAY_STYLE;
  const association = useSurfaceAssociationState();
  const surfaces = useSurfaceStore(state => state.surfaces);
  const activeSurfaceId = useSurfaceStore(state => state.activeSurfaceId);
  const missingAnatomy = useMemo(() => {
    const displayed = collectRenderSurfaces(surfaces, activeSurfaceId);
    const anatomy = resolveCursorAnatomy(displayed, surfaces.values());
    return displayed.some(surface => !anatomy.has(surface.handle));
  }, [surfaces, activeSurfaceId]);

  // No surface loaded: defer to the SurfaceViewPanel empty-state, which owns the
  // single "Load surface" invitation. Rendering a second load CTA here would
  // duplicate a control in the same region (Design.md §22: no duplicate control
  // surfaces). The badge speaks only to the association of a *loaded* surface.
  if (association.kind === "missing") {
    return null;
  }

  if (missingAnatomy) {
    return (
      <div style={wrapperStyle} data-placement={inline ? "strip" : "overlay"}>
        <div data-testid="surface-association-badge" data-state="cursor-unavailable"
          style={inline ? inlineStatusStyle("var(--bf-warning)") : CAVEAT_STYLE}
          title="Load a matching pial or white surface with the same vertex topology to link this display to volume coordinates.">
          <Link2Off width={12} height={12} aria-hidden="true"
            style={inline ? { color: "var(--bf-warning)", flex: "0 0 auto" } : undefined} />
          <span style={inline ? { overflow: "hidden", textOverflow: "ellipsis" } : undefined}>
            Load matching pial/white surface to link coordinates
          </span>
        </div>
      </div>
    );
  }

  if (association.kind === "loaded-unlinked") {
    const reasonLabel =
      association.reason === "source-not-loaded"
        ? "Source volume not loaded"
        : "No source volume";
    return (
      <div style={wrapperStyle} data-placement={inline ? "strip" : "overlay"}>
        <div
          data-testid="surface-association-badge"
          data-state="loaded-unlinked"
          data-reason={association.reason}
          style={
            inline
              ? inlineStatusStyle("var(--bf-warning)")
              : { ...CARD_BASE_STYLE, color: "var(--bf-warning)" }
          }
          title={`${association.surfaceName}: ${reasonLabel}`}
        >
          <Link2Off width={12} height={12} aria-hidden="true"
            style={inline ? { color: "var(--bf-warning)", flex: "0 0 auto" } : undefined} />
          <span data-testid="surface-association-state">Source unlinked</span>
          <span
            data-testid="surface-association-detail"
            style={DETAIL_STYLE}
          >
            · {reasonLabel}
          </span>
        </div>
      </div>
    );
  }

  if (association.kind === "template-underlay") {
    return (
      <div style={wrapperStyle} data-placement={inline ? "strip" : "overlay"}>
        <div
          data-testid="surface-association-badge"
          data-state="template-underlay"
          style={inline ? inlineStatusStyle("var(--bf-border-strong)") : CARD_BASE_STYLE}
          title={`${association.surfaceName}: Template surface; coordinate linking requires a volume in the same world space`}
        >
          <Brain width={12} height={12} aria-hidden="true" style={{ color: "var(--bf-text-muted)" }} />
          <span data-testid="surface-association-state">Template surface</span>
          <span
            data-testid="surface-association-detail"
            style={DETAIL_STYLE}
          >
            · template surface
          </span>
        </div>
      </div>
    );
  }

  // loaded-linked
  return (
    <div style={wrapperStyle} data-placement={inline ? "strip" : "overlay"}>
      <div
        data-testid="surface-association-badge"
        data-state="loaded-linked"
        style={inline ? inlineStatusStyle("var(--bf-border-strong)") : CARD_BASE_STYLE}
        title={`${association.surfaceName} ↔ ${association.volumeName}`}
      >
        <Link width={12} height={12} aria-hidden="true" style={{ color: "var(--bf-success)" }} />
        <span data-testid="surface-association-state">Source linked</span>
        <span
          data-testid="surface-association-volume"
          style={{
            ...DETAIL_STYLE,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          · {association.volumeName}
        </span>
      </div>
    </div>
  );
};

export default SurfaceAssociationBadge;
