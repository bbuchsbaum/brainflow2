function extractMessage(record: Record<string, unknown>): string | null {
  const direct =
    (typeof record.message === 'string' && record.message) ||
    (typeof record.details === 'string' && record.details) ||
    (typeof record.error === 'string' && record.error) ||
    (typeof record.path === 'string' && record.path);
  if (direct) {
    return direct;
  }

  // Tauri/Rust enum-style payloads often look like:
  // { Input: { code: 8224, details: "..." } }
  const nestedEntries = Object.entries(record);
  if (nestedEntries.length === 1) {
    const nestedValue = nestedEntries[0][1];
    if (typeof nestedValue === 'string') {
      return nestedValue;
    }
    if (nestedValue && typeof nestedValue === 'object') {
      return extractMessage(nestedValue as Record<string, unknown>);
    }
  }

  return null;
}

export function formatTauriError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = extractMessage(record);
    if (message) return message;

    try {
      return JSON.stringify(record);
    } catch {
      return String(record);
    }
  }

  return String(error);
}

/** Normalize a bridge rejection for APIs and event payloads that require Error. */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error == null ? 'Unknown error' : formatTauriError(error), { cause: error });
}

/**
 * The numeric bridge error code of a rejection (`{ Input: { code, details } }`,
 * `{ code, ... }`, or an Error whose cause is one), else null.
 */
export function tauriErrorCode(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== 'object' || depth > 3) return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'number') return record.code;
  if (error instanceof Error) return tauriErrorCode((error as Error & { cause?: unknown }).cause, depth + 1);
  for (const value of Object.values(record)) {
    const code = tauriErrorCode(value, depth + 1);
    if (code !== null) return code;
  }
  return null;
}

const LOAD_FAILURE_PREFIX = /^\s*failed to load\b[^:\n]*:\s*/i;

/**
 * "Failed to load <subject>: <detail>", without repeating the prefix when the
 * detail already carries one (the bridge reports "Failed to load file /path:
 * …", which read as "Failed to load X: Failed to load file /path: …").
 */
export function loadFailureMessage(subject: string, error: unknown): string {
  let detail = formatTauriError(error).trim();
  while (LOAD_FAILURE_PREFIX.test(detail)) {
    const stripped = detail.replace(LOAD_FAILURE_PREFIX, '');
    if (!stripped) break;
    detail = stripped;
  }
  return detail ? `Failed to load ${subject}: ${detail}` : `Failed to load ${subject}`;
}
