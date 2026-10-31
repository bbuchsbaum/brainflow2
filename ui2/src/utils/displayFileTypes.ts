/** File types the display pipeline opens (DisplayLifecycleOrchestrator). */
export const SUPPORTED_DISPLAY_EXTENSIONS = ['.nii', '.nii.gz', '.gii', '.gifti'] as const;

export function isSupportedDisplayPath(path: string): boolean {
  const lower = path.toLowerCase();
  return SUPPORTED_DISPLAY_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
