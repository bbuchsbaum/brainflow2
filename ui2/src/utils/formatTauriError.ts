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
