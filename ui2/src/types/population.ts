export interface PopulationParticipantDefinition {
  readonly setId: string;
  readonly identity:
    | { readonly kind: 'observationIds' }
    | { readonly kind: 'column'; readonly column: string };
  /** observations retains equal row weighting; single rejects repeated selected
   * rows; mean gives each participant equal weight after averaging selected rows. */
  readonly reduction: 'observations' | 'single' | 'mean';
}

/** Population definitions contain IDs and parameters, never image arrays. */
export type PopulationSelectionOrigin = 'manual' | 'metadata' | 'map-derived';

export type PopulationWorkingSelection =
  | { readonly kind: 'context' }
  | {
      readonly kind: 'members';
      readonly memberIds: readonly string[];
      readonly origin: PopulationSelectionOrigin;
      readonly label: string;
    };

export interface PopulationProbe {
  /** Audited support identity/revision supplied by the source registry. */
  readonly supportKey: string;
  /** Coordinates in the preserved NIfTI affine world frame (+R, +A, +S). */
  readonly worldMm: readonly [number, number, number];
  /** Zero denotes a point; positive values denote a physical sphere. */
  readonly radiusMm: number;
  readonly reduce: 'mean' | 'median' | 'min' | 'max' | 'sum';
}

export interface PopulationRelationship {
  readonly fitId: string;
  readonly sessionRevision: number;
  readonly featureId: string;
  readonly supportKey: string;
  readonly contextMemberIds: readonly string[];
  readonly distance: 'effect' | 'pattern-shape';
}

export interface PopulationState {
  readonly participants: PopulationParticipantDefinition | null;
  /** In-memory import generation; distinct from a file/content revision. */
  readonly sessionRevision: number;
  readonly working: PopulationWorkingSelection;
  /** A fixed cohort uses the existing selection.compareCohortId. */
  readonly referenceMode: 'cohort' | 'complement';
  readonly pinnedProbe: PopulationProbe | null;
  readonly hoverProbe: PopulationProbe | null;
  readonly relationship: PopulationRelationship | null;
  /** Selection undo never rewinds focus, probes or references. */
  readonly selectionPast: readonly PopulationWorkingSelection[];
  readonly selectionFuture: readonly PopulationWorkingSelection[];
}

export type PopulationActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface PopulationContext {
  readonly memberIds: readonly string[];
  readonly issue: string | null;
}
