/**
 * The slicing axis each mounted mosaic shows, by workspace, so the slice keys
 * (↑/↓, PageUp/PageDown) step the mosaic's own axis while a Mosaic tab is in
 * front (QA 2026-10-31: ↑ stepped x, the last orthogonal view, not the axial
 * mosaic).
 */
import type { ViewType } from '@/types/coordinates';

const axes = new Map<string, ViewType>();

export function setMosaicAxis(workspaceId: string, axis: ViewType): () => void {
  axes.set(workspaceId, axis);
  return () => {
    if (axes.get(workspaceId) === axis) axes.delete(workspaceId);
  };
}

export function mosaicAxisOf(workspaceId: string): ViewType | undefined {
  return axes.get(workspaceId);
}
