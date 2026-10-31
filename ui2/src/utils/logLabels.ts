/**
 * Names the Log shows for layers and their sources (QA 2026-10-30 F40: the
 * Log read "Loaded atlas:freesurfer_aseg", "Removed atlas:olsen_mtl" and
 * "Layer volume_c error: undefined").
 */

/**
 * A source that names a catalogue item rather than a file: `atlas:<id>`,
 * `template:<id>`. A drive letter (`C:\…`) or a URL (`sftp://…`) is a path.
 */
export function isCatalogSource(path: string | null | undefined): boolean {
  return !!path && /^[a-z][a-z0-9_-]+:(?![\\/])/i.test(path);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * The label of a layer or load in the Log: the file name for a file, the
 * display name for a catalogue atlas or template (else its id without the
 * scheme), then the fallback.
 */
export function sourceLabel(
  sourcePath: string | null | undefined,
  displayName: string | null | undefined,
  fallback = '',
): string {
  if (sourcePath && !isCatalogSource(sourcePath)) {
    const file = basename(sourcePath);
    if (file) return file;
  }
  if (displayName && displayName.trim()) return displayName.trim();
  if (sourcePath) return sourcePath.slice(sourcePath.indexOf(':') + 1) || sourcePath;
  return fallback;
}

/** The text of an error, never "undefined", "null" or "[object Object]". */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message && message !== 'undefined' && message !== 'null') return message;
    return error.name && error.name !== 'Error' ? error.name : 'unknown error';
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message && message !== 'undefined' && message !== 'null' ? message : 'unknown error';
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return errorText(String((error as { message: unknown }).message ?? ''));
  }
  return 'unknown error';
}

/**
 * A Log message with no "undefined" or "null" left where a value was
 * missing ("error: undefined" → "error: unknown error"), and never empty.
 */
export function sanitizeLogMessage(message: unknown): string {
  if (typeof message !== 'string') return errorText(message);
  const cleaned = message
    .replace(/:\s*(?:undefined|null|\[object Object\])\s*$/i, ': unknown error')
    .trim();
  if (!cleaned || /^(?:undefined|null|\[object Object\])$/i.test(cleaned)) return 'Unknown error';
  return cleaned;
}
