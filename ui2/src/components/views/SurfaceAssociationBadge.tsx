/**
 * SurfaceAssociationBadge — Phase 5c of the integrated workspace refactor.
 *
 * Renders inside the integrated workspace's surface region as a small
 * absolutely-positioned banner that surfaces the current surface ↔ volume
 * relationship. Three states (driven by `useSurfaceAssociationState`):
 *
 *   missing         → "No surface loaded" with a "Load surface…" CTA.
 *   loaded-unlinked → orange unlinked indicator + a hint about how to link.
 *   loaded-linked   → quiet linked indicator naming the source volume.
 *
 * The badge is **non-blocking** — it sits in the top-left of the surface
 * canvas at low opacity until hovered. Surface canvas interactions
 * continue to work behind it (pointer-events on the inner card only).
 */

import React from "react";
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

const CARD_BASE_STYLE: React.CSSProperties = {
  pointerEvents: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 8px",
  background: "rgba(8, 17, 28, 0.86)",
  border: "1px solid var(--app-border-subtle)",
  borderRadius: "4px",
  color: "var(--app-text-secondary)",
  fontSize: "var(--app-role-section-size)",
  letterSpacing: "var(--app-role-section-tracking)",
  textTransform: "uppercase",
  fontWeight: 600,
  backdropFilter: "blur(6px)",
  whiteSpace: "nowrap",
  maxWidth: "320px",
};

export const SurfaceAssociationBadge: React.FC = () => {
  const association = useSurfaceAssociationState();

  // No surface loaded: defer to the SurfaceViewPanel empty-state, which owns the
  // single "Load surface" invitation. Rendering a second load CTA here would
  // duplicate a control in the same region (Design.md §22: no duplicate control
  // surfaces). The badge speaks only to the association of a *loaded* surface.
  if (association.kind === "missing") {
    return null;
  }

  if (association.kind === "loaded-unlinked") {
    const reasonLabel =
      association.reason === "source-not-loaded"
        ? "Source volume not loaded"
        : "No source volume";
    return (
      <div style={ABS_OVERLAY_STYLE}>
        <div
          data-testid="surface-association-badge"
          data-state="loaded-unlinked"
          data-reason={association.reason}
          style={{
            ...CARD_BASE_STYLE,
            color: "var(--app-warning, #f59e0b)",
            borderColor: "rgba(245, 158, 11, 0.45)",
          }}
          title={`${association.surfaceName}: ${reasonLabel}`}
        >
          <Link2Off width={12} height={12} aria-hidden="true" />
          <span data-testid="surface-association-state">Unlinked</span>
          <span
            data-testid="surface-association-detail"
            style={{
              color: "var(--app-text-muted)",
              fontWeight: 450,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            · {reasonLabel}
          </span>
        </div>
      </div>
    );
  }

  if (association.kind === "template-underlay") {
    return (
      <div style={ABS_OVERLAY_STYLE}>
        <div
          data-testid="surface-association-badge"
          data-state="template-underlay"
          style={{
            ...CARD_BASE_STYLE,
            color: "var(--app-accent, #5b9dff)",
            borderColor: "rgba(91, 157, 255, 0.45)",
          }}
          title={`${association.surfaceName}: MNI template underlay`}
        >
          <Brain width={12} height={12} aria-hidden="true" />
          <span data-testid="surface-association-state">MNI underlay</span>
          <span
            data-testid="surface-association-detail"
            style={{
              color: "var(--app-text-muted)",
              fontWeight: 450,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            · template surface
          </span>
        </div>
      </div>
    );
  }

  // loaded-linked
  return (
    <div style={ABS_OVERLAY_STYLE}>
      <div
        data-testid="surface-association-badge"
        data-state="loaded-linked"
        style={{
          ...CARD_BASE_STYLE,
          color: "var(--app-success, #35d36b)",
          borderColor: "rgba(53, 211, 107, 0.45)",
        }}
        title={`${association.surfaceName} ↔ ${association.volumeName}`}
      >
        <Link width={12} height={12} aria-hidden="true" />
        <span data-testid="surface-association-state">Linked</span>
        <span
          data-testid="surface-association-volume"
          style={{
            color: "var(--app-text-muted)",
            fontWeight: 450,
            textTransform: "none",
            letterSpacing: 0,
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
