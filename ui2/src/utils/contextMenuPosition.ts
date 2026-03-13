export interface ContextMenuSize {
  width: number;
  height: number;
}

export interface ContextMenuViewport {
  width: number;
  height: number;
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  pad = 6
): { left: number; top: number } {
  const maxX = viewport.width - size.width - pad;
  const maxY = viewport.height - size.height - pad;

  return {
    left: Math.max(pad, Math.min(x, maxX)),
    top: Math.max(pad, Math.min(y, maxY)),
  };
}
