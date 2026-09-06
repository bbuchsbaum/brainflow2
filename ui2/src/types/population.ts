/** Exact source/frame identity carried through every restored image and probe request. */
export interface PopulationMemberSource {
  memberId: string;
  sourcePath: string;
  stackIndex?: number;
  expectedSha256?: string;
}

/** Common binary support; physical grid is validated by native sampling. */
export interface PopulationMask {
  readonly sourcePath: string;
  readonly expectedSha256?: string;
}

export interface PopulationParticipantDefinition {
  readonly setId: string;
  readonly identity:
    | { readonly kind: 'observationIds' }
    | { readonly kind: 'column'; readonly column: string }
    | {
        readonly kind: 'saved';
        readonly groups: readonly { participantId: string; memberIds: readonly string[] }[];
      };
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

export interface PopulationOrder {
  readonly featureId: string;
  readonly rule: 'response' | 'similarity';
  readonly fitId?: string;
  readonly orderedIds: readonly string[];
  readonly unavailableIds: readonly string[];
  readonly label: string;
  readonly probe: PopulationProbe | null;
  readonly bindings: readonly PopulationMemberSource[];
  readonly mask: PopulationMask | null;
  readonly tieRule: 'source';
}
export interface PopulationPresentation {
  readonly arrangement: 'inspect' | 'montage' | 'groups' | 'comparison' | 'difference';
  readonly gallery?: 'context' | 'working';
  readonly contributorsGroupId?: string;
  readonly montageScope?: 'plane' | 'probe';
  readonly order: PopulationOrder | null;
}

export interface PopulationPartition {
  readonly setId: string;
  readonly column: string;
  readonly contextIds: readonly string[];
  readonly groups: readonly {
    id: string;
    label: string;
    value: string | null;
    memberIds: readonly string[];
  }[];
  readonly origin: 'metadata' | 'map-derived';
  readonly fitId?: string;
}

export interface PopulationState {
  readonly inference: PopulationInference | null;
  readonly partition: PopulationPartition | null;
  readonly partitionPast: readonly (PopulationPartition | null)[];
  readonly presentation: PopulationPresentation;
  /** Applied once on restore; subsequent exploration is ordinary live state. */
  readonly restoredView?: {
    orientation: 'axial' | 'coronal' | 'sagittal';
    summary: 'mean' | 'sampleSd' | 'meanAbsolute' | 'cancellation' | 'coverage';
    zoom: number;
    effectLimit?: number;
    summaryLimit?: number;
  };

  readonly mask: (PopulationMask & { readonly setId: string }) | null;
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

/** User-declared feature meaning; input roles are never inferred from filenames. */
export interface PopulationInferenceSpec {
  method: 'oneSample' | 'welch';
  role: 'effect' | 'standardError' | 'variance' | 't' | 'z' | 'label' | 'other';
  units: string;
  nullValue: number;
  independentParticipants: boolean;
  selectionOrigin: PopulationSelectionOrigin;
  channel: 'effect' | 'standardError' | 't' | 'df' | 'count' | 'countA' | 'countB';
}
export interface PopulationInference extends PopulationInferenceSpec {
  setId: string;
  featureId: string;
}
