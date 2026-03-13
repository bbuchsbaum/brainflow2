import { useSurfaceCommandContextValue } from './useSurfaceSelectionContext';

export function useResolvedActiveSurfaceViewId(): string | null {
  return useSurfaceCommandContextValue().surfaceViewId;
}
