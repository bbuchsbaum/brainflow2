import type { DraggedResource } from '@/types/loadIntent';

export const LAYER_DRAG_MIME = 'application/x-brainflow-layer+json';
export const FILE_DRAG_MIME = 'application/x-brainflow-file+json';

export interface LayerDragData {
  layerId: string;
}

export interface FileDragData {
  path: string;
  name: string;
  type: string;
  extension?: string;
}

export function serializeLayerDragData(data: LayerDragData): string {
  return JSON.stringify(data);
}

export function serializeFileDragData(data: FileDragData): string {
  return JSON.stringify(data);
}

export function parseLayerDragData(raw: string | null | undefined): LayerDragData | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LayerDragData>;
    if (typeof parsed.layerId !== 'string' || parsed.layerId.length === 0) {
      return null;
    }
    return { layerId: parsed.layerId };
  } catch {
    return null;
  }
}

export function parseFileDragData(raw: string | null | undefined): FileDragData | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<FileDragData>;
    if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
      return null;
    }
    return {
      path: parsed.path,
      name: parsed.name ?? '',
      type: parsed.type ?? 'file',
      extension: parsed.extension,
    };
  } catch {
    return null;
  }
}

export function readLayerDragData(dataTransfer: DataTransfer | null): LayerDragData | null {
  if (!dataTransfer) {
    return null;
  }

  return (
    parseLayerDragData(dataTransfer.getData(LAYER_DRAG_MIME)) ??
    parseLayerDragData(dataTransfer.getData('application/json'))
  );
}

export function readFileDragData(dataTransfer: DataTransfer | null): FileDragData | null {
  if (!dataTransfer) {
    return null;
  }

  return (
    parseFileDragData(dataTransfer.getData(FILE_DRAG_MIME)) ??
    parseFileDragData(dataTransfer.getData('application/json'))
  );
}

/**
 * Read any drag data and normalize to a DraggedResource.
 * Tries layer MIME first, then file MIME, then generic JSON.
 */
export function readDraggedResource(dataTransfer: DataTransfer | null): DraggedResource | null {
  if (!dataTransfer) return null;

  const layerData = readLayerDragData(dataTransfer);
  if (layerData) {
    return { kind: 'loaded-layer', layerId: layerData.layerId };
  }

  const fileData = readFileDragData(dataTransfer);
  if (fileData) {
    return { kind: 'filesystem-file', path: fileData.path, extension: fileData.extension };
  }

  return null;
}
