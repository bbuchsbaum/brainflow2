import type { ViewLayer } from './viewState';

export interface ImageSetMember {
  path: string;
  name: string;
}

/** A browsing collection: geometry and display ranges belong to each member. */
export interface ImageSelectionSet {
  id: string;
  name: string;
  folder: string;
  members: ImageSetMember[];
  layerId: string | null;
  activeIndex: number;
  pendingIndex: number | null;
  error: string | null;
  renderByMember: Record<string, Record<string, ViewLayer>>;
}

export interface ImageSetPreview {
  id: string;
  folder: string;
  workspaceId: string;
  members: ImageSetMember[];
  loading: boolean;
  opening: boolean;
  error: string | null;
  setId?: string;
  /** Members to start checked (default: all), e.g. the Files search matches. */
  initialSelected?: string[];
  /** Filter text to start with, used only if it shows exactly `initialSelected`. */
  initialQuery?: string;
}
