import type { DraggedResource } from '@/types/loadIntent';

export const LAYER_DRAG_MIME = 'application/x-brainflow-layer+json';
export const FILE_DRAG_MIME = 'application/x-brainflow-file+json';

/**
 * Cross-panel drag data bridge.
 *
 * GoldenLayout creates isolated React roots per panel, and its internal
 * drag-drop handling can swallow native events before they reach React's
 * delegated listeners.  We work around this by stashing drag payload in a
 * module-level variable that any panel can read — no reliance on
 * `dataTransfer.getData()` across panel boundaries.
 */
let _activeDragData: FileDragData | null = null;

export function setActiveDragData(data: FileDragData | null): void {
  _activeDragData = data;
}

export function getActiveDragData(): FileDragData | null {
  return _activeDragData;
}

export function clearActiveDragData(): void {
  _activeDragData = null;
}

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
    parseFileDragData(dataTransfer.getData('application/json')) ??
    (() => {
      const plainTextPath = dataTransfer.getData('text/plain')?.trim();
      if (!plainTextPath) {
        return null;
      }
      return {
        path: plainTextPath,
        name: plainTextPath.split(/[\\/]/).pop() ?? plainTextPath,
        type: 'file',
      };
    })()
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
