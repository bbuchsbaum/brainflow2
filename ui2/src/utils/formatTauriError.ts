export function formatTauriError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.details === 'string' && record.details) ||
      (typeof record.error === 'string' && record.error);
    if (message) return message;

    try {
      return JSON.stringify(record);
    } catch {
      return String(record);
    }
  }

  return String(error);
}

