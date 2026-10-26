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
 * Colour policy: the unlinked state is a warning (`--bf-warning`); the
 * pial/white coordinate-linking note is neutral (an optional surface). The template note is neutral guidance; the linked
 * state carries `--bf-success` on its icon only. Amber is reserved for the
 * accent, so none of these states use it.
 *
 * Form: a bf `Notice`. Inline (the Integrated surface pane's top strip) it is
 * the panel form (left hairline + icon + text, no box); as an overlay on the
 * canvas it is the boxed canvas form.
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
import { Notice, type NoticeSeverity } from "@/components/ui/bf";

import { useSurfaceAssociationState } from "./surfaceAssociation.helpers";

const ABS_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "8px",
  left: "8px",
  zIndex: 4,
  pointerEvents: "none",
  display: "flex",
  maxWidth: "320px",
};

// Inline: the badge is the surface pane's top-margin status strip. It sits
// over the pane's top 28px (the surface panel keeps the full pane so its
// camera framing is unchanged).
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

const ICON = "mt-px h-3 w-3 shrink-0";

interface BadgeNoticeProps {
  inline: boolean;
  state: string;
  severity: NoticeSeverity;
  icon: React.ReactNode;
  title: string;
  reason?: string;
  children: React.ReactNode;
}

function BadgeNotice({ inline, state, severity, icon, title, reason, children }: BadgeNoticeProps) {
  return (
    <div
      style={inline ? INLINE_STRIP_STYLE : ABS_OVERLAY_STYLE}
      data-placement={inline ? "strip" : "overlay"}
    >
      <Notice
        data-testid="surface-association-badge"
        data-state={state}
        data-reason={reason}
        severity={severity}
        surface={inline ? "panel" : "canvas"}
        icon={icon}
        title={title}
        className="pointer-events-auto min-w-0 max-w-full whitespace-nowrap"
      >
        <span className="block truncate">{children}</span>
      </Notice>
    </div>
  );
}

export const SurfaceAssociationBadge: React.FC<{
  /** Render as a top-margin strip instead of an overlay on the canvas. */
  inline?: boolean;
}> = ({ inline = false }) => {
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
      <BadgeNotice
        inline={inline}
        state="cursor-unavailable"
        // An optional surface is missing, not a fault: a muted note, no
        // warning bar (P3.10, v0 visual critic).
        severity="neutral"
        icon={<Link2Off className={`${ICON} text-muted-foreground`} />}
        title="Load a matching pial or white surface with the same vertex topology to link this display to volume coordinates."
      >
        <span className="text-muted-foreground">Load matching pial/white surface to link coordinates</span>
      </BadgeNotice>
    );
  }

  if (association.kind === "loaded-unlinked") {
    const reasonLabel =
      association.reason === "source-not-loaded"
        ? "Source volume not loaded"
        : "No source volume";
    return (
      <BadgeNotice
        inline={inline}
        state="loaded-unlinked"
        reason={association.reason}
        severity="warning"
        icon={<Link2Off className={ICON} />}
        title={`${association.surfaceName}: ${reasonLabel}`}
      >
        <span data-testid="surface-association-state">Source unlinked</span>
        <span data-testid="surface-association-detail" className="text-muted-foreground">
          {" "}· {reasonLabel}
        </span>
      </BadgeNotice>
    );
  }

  if (association.kind === "template-underlay") {
    return (
      <BadgeNotice
        inline={inline}
        state="template-underlay"
        severity="neutral"
        icon={<Brain className={`${ICON} text-muted-foreground`} />}
        title={`${association.surfaceName}: Template surface; coordinate linking requires a volume in the same world space`}
      >
        <span data-testid="surface-association-state">Template surface</span>
        <span data-testid="surface-association-detail" className="text-muted-foreground">
          {" "}· template surface
        </span>
      </BadgeNotice>
    );
  }

  // loaded-linked: success colour on the icon only; the text stays neutral.
  return (
    <BadgeNotice
      inline={inline}
      state="loaded-linked"
      severity="neutral"
      icon={<Link className={`${ICON} text-bf-success`} />}
      title={`${association.surfaceName} ↔ ${association.volumeName}`}
    >
      <span data-testid="surface-association-state">Source linked</span>
      <span data-testid="surface-association-volume" className="text-muted-foreground">
        {" "}· {association.volumeName}
      </span>
    </BadgeNotice>
  );
};

export default SurfaceAssociationBadge;
