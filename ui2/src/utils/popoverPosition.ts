export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverViewport {
  width: number;
  height: number;
}

export function clampPopoverPosition(
  x: number,
  y: number,
  size: PopoverSize,
  viewport: PopoverViewport,
  pad = 8
): { left: number; top: number } {
  const maxX = viewport.width - size.width - pad;
  const maxY = viewport.height - size.height - pad;

  return {
    left: Math.max(pad, Math.min(x, maxX)),
    top: Math.max(pad, Math.min(y, maxY)),
  };
}
