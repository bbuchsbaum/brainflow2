import { create } from 'zustand';
import type { ImageSelectionSet, ImageSetPreview } from '@/types/imageSet';

interface ImageSetState {
  sets: Record<string, ImageSelectionSet>;
  preview: ImageSetPreview | null;
}

/** Shared by the Files root and every Inspector root. ImageSetService owns writes. */
export const useImageSetStore = create<ImageSetState>(() => ({ sets: {}, preview: null }));
