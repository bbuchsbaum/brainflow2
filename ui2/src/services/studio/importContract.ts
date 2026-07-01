import type {
  SpatialFieldSetSummary,
  StudioImportCandidate,
  StudioImportCapability,
  StudioImportContract,
  StudioImportReadiness,
} from '@/types/studio';

export function hasImportCapability(
  contract: StudioImportContract | null | undefined,
  capability: StudioImportCapability
): boolean {
  return contract?.capabilities.includes(capability) ?? false;
}

export function canImportCandidate(candidate: StudioImportCandidate): boolean {
  return candidate.contract.canImport;
}

export function candidateImportReadiness(candidate: StudioImportCandidate): StudioImportReadiness {
  return candidate.contract.readiness;
}

export function setImportReadiness(set: SpatialFieldSetSummary | null): StudioImportReadiness | null {
  return set?.importContract?.readiness ?? null;
}

export function isCompareReadyContract(contract: StudioImportContract | null | undefined): boolean {
  return (
    contract?.readiness === 'compare_ready' &&
    hasImportCapability(contract, 'compare') &&
    hasImportCapability(contract, 'materialize_compare')
  );
}

export function isSetCompareReady(set: SpatialFieldSetSummary | null): boolean {
  return isCompareReadyContract(set?.importContract);
}

export function isSetInspectOnly(set: SpatialFieldSetSummary | null): boolean {
  return set?.importContract?.readiness === 'inspect_only';
}
