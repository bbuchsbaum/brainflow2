/**
 * Round 5: contrast aids (state `contrast-aids`). Three view-only aids, none
 * of which can be mistaken for a data edit:
 *
 * - A view-only filter on the primary (unsharp mask of T2w) announced by a
 *   neutral badge beside the geometry title, derived from the image itself
 *   (`workflowRules.filterBadge`), so a filter is never on without it. The
 *   recipe sits in the Inspector and the badge's tooltip. No label colour,
 *   no hatch, no outline change: filters touch pixels of the image only.
 * - The cursor lens: T1w at the same scale and position under the brush
 *   tip, in a round window with a neutral rim; the active label's outline
 *   and the brush footprint continue through it, so the border can be
 *   checked against T1w without moving the eye.
 * - Hold-to-flicker keys in the header (V: raw T2w, Space: T1w).
 *
 * Every edit maps through the raw T2w grid; nothing filtered is saved or
 * sent to an AI provider.
 */

import React from 'react';
import { Aperture } from 'lucide-react';
import { Chip, SegmentedControl, Select, Switch } from '@/components/ui/bf';
import { SliceView, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { Kbd, StatusItem } from '@/modules/segmentation/components/shared/chrome';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { BRUSH, CA1 } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { filterBadge } from '@/modules/segmentation/components/shared/workflowRules';
import type { SliceImage } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { BrushStrip, GeometryTitle, HShell, InspectorFrame, LabelsSection, SessionHeader, SliceRuler, StepCard, TextToggle, ToolRail } from '@/modules/segmentation/components/directions/h/DirectionH';
import { hPrimary } from '@/modules/segmentation/components/directions/h/hViews';
import { OrthoColumn, PrimaryPanel, StateChip, TraceGrid } from './parts';

/** The filter's recipe (mock: the generator's view-only unsharp mask). */
const RECIPE = 'T2w → unsharp mask σ 1.5 mm, amount 1.2 (world-anchored) → window 12–230';

/** Lens diameter (screen px). */
const LENS_PX = 136;

/** The badge every filtered view carries: neutral, outlined, the filter's name and "view only". */
export function FilterBadge({ image }: { image: Pick<SliceImage, 'viewOnly' | 'contrast'> }) {
  const text = filterBadge(image);
  if (!text) return null;
  return (
    <Chip
      icon={<Aperture className="h-3 w-3" aria-hidden />}
      className="border border-bf-border-strong bg-transparent text-bf-text-primary"
      title={`View-only filter: ${RECIPE}. Edits map through the raw T2w; nothing filtered is saved. Hold V to flicker raw.`}
      data-testid="filter-badge"
    >
      {text}
    </Chip>
  );
}

/** The cursor lens: T1w 1:1 under the brush tip, the active label's outline and the footprint continuing through it. */
function Lens({ p }: { p: Projector }) {
  const at = p.project(SCENE.tracing.brush);
  const fov = LENS_PX / p.scale;
  const labels = OVERLAYS.withStroke(SCENE.tracing.base, SCENE.tracing.wet);
  return (
    <>
      <div
        className="pointer-events-none absolute overflow-hidden rounded-full shadow-[0_0_0_1px_var(--bf-bg-canvas),0_0_0_2px_var(--bf-text-primary),0_0_0_4px_rgba(0,0,0,0.45)]"
        style={{ left: at.x - LENS_PX / 2, top: at.y - LENS_PX / 2, width: LENS_PX, height: LENS_PX }}
        data-testid="cursor-lens"
      >
        <SliceView
          image={DESIGN.images.corT1}
          center={SCENE.tracing.brush}
          fovMm={fov}
          crosshair={null}
          letters={false}
          overlays={OVERLAYS.echo(labels, CA1)}
          brush={{ center: SCENE.tracing.brush, radiusMm: BRUSH.radiusMm, label: CA1 }}
          aria-label="Lens: T1w under the brush"
        />
      </div>
      <span
        className="pointer-events-none absolute whitespace-nowrap rounded-sm bg-bf-bg-canvas/80 px-1 text-bf-2xs leading-4 text-bf-text-primary"
        style={{ left: at.x + LENS_PX * 0.36, top: at.y + LENS_PX * 0.4 }}
        data-testid="lens-caption"
      >
        T1w · 1:1
      </span>
    </>
  );
}

/** Hold-to-flicker keys, beside the zoom. */
function FlickerKeys() {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-bf-2xs text-bf-text-muted" data-testid="flicker-keys" title="Hold to flicker in place; release to return">
      <Kbd>V</Kbd>raw
      <Kbd>Space</Kbd>T1w
      <Kbd>⌥</Kbd>lens
    </span>
  );
}

function ViewAids() {
  return (
    <section className="flex flex-col gap-1.5 border-b border-bf-border-subtle px-3 py-2" data-testid="view-aids">
      <div className="flex items-baseline gap-2">
        <span className="text-bf-xs font-medium text-bf-text-primary">View aids</span>
        <span className="text-bf-2xs text-bf-text-muted">display only · never written</span>
      </div>
      <div className="flex items-center gap-2 text-bf-xs">
        <Switch checked aria-label="Filter on" />
        <span className="w-12 text-bf-text-secondary">Filter</span>
        <Select
          aria-label="Filter"
          defaultValue="unsharp"
          className="min-w-0 flex-1"
          options={[
            { value: 'none', label: 'None (raw T2w)' },
            { value: 'unsharp', label: 'Unsharp mask' },
            { value: 'clahe', label: 'CLAHE 2D, tiles 8 mm' },
            { value: 'z', label: 'Local z-score, σ 6 mm' },
            { value: 'gamma', label: 'Gamma 0.7' },
          ]}
        />
      </div>
      <span className="pl-[38px] font-mono text-bf-2xs leading-snug text-bf-text-muted" data-testid="filter-recipe">
        {RECIPE}
      </span>
      <div className="flex items-center gap-2 text-bf-xs">
        <Switch checked={false} aria-label="Lens pinned" title="The lens shows while ⌥ is held; pin it to keep it on" />
        <span className="w-12 text-bf-text-secondary">Lens</span>
        <SegmentedControl
          aria-label="Lens content"
          size="sm"
          value="t1"
          onValueChange={() => undefined}
          options={[
            { value: 't1', label: 'T1w' },
            { value: 'raw', label: 'Raw T2w' },
            { value: 'x4', label: '4× vx' },
          ]}
        />
        <span className="ml-auto text-bf-2xs text-bf-text-muted">hold ⌥</span>
      </div>
      <span className="text-bf-2xs leading-snug text-bf-text-muted">
        Edits map through the raw T2w grid. Filters are hints: no protocol validates them, and each can move a soft edge.
      </span>
    </section>
  );
}

export function ContrastAidsState() {
  const base = hPrimary('tracing');
  const filtered = DESIGN.images.corT2u;
  const view = { ...base, image: filtered };
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <HShell
      testState="contrast-aids"
      paint
      status={
        <>
          <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
          <StatusItem label="Label" value="CA1" mono={false} />
          <StatusItem label="View" value="T2w · unsharp, view only" mono={false} />
        </>
      }
      rail={<ToolRail state="tracing" />}
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" />
          <StepCard state="tracing" />
          <ViewAids />
          <LabelsSection state="tracing" hover={null} />
        </InspectorFrame>
      }
    >
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={
              <span className="flex min-w-0 items-center gap-2">
                {/* The title names the data (T2w); the badge names the view. */}
                <GeometryTitle image={DESIGN.images.corT2} />
                <FilterBadge image={filtered} />
              </span>
            }
            right={
              <>
                <span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(view.fovMm)}</span>
                <TextToggle pressed={false} title="Linked contrasts (C)">
                  Contrasts
                </TextToggle>
              </>
            }
            line2={
              <>
                <BrushStrip />
                <span className="ml-auto">
                  <FlickerKeys />
                </span>
              </>
            }
            view={view}
            overlay={(p) => <Lens p={p} />}
            ruler={<SliceRuler state="tracing" />}
          />
        }
        side={<OrthoColumn />}
      />
    </HShell>
  );
}
