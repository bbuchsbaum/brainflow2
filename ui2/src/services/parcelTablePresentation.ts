import type { ParcelColumnInfo } from '@brainflow/api';

// Header recognition only suggests a mapping. Values still go through the
// backend's exact, atlas-specific join; never infer identity from row order.
const idHeaders = new Set(['roi_id', 'parcel_id', 'label_id', 'id']);
export function isParcelIdColumn(name: string): boolean {
  return idHeaders.has(name.trim().toLowerCase());
}

export function suggestParcelIdColumn(headers: string[]): string | null {
  const candidates = headers.filter(isParcelIdColumn);
  return candidates.length === 1 ? candidates[0] : null;
}

export function parcelMetricColumns(
  columns: ParcelColumnInfo[],
  keyColumns: (string | null)[],
): ParcelColumnInfo[] {
  return columns.filter((c) => !keyColumns.includes(c.name) && !isParcelIdColumn(c.name));
}

export function parcelBindingMessage(error: string): { message: string; detail?: string } {
  const detail = error.replace(/^(?:(?:Invalid input|Invalid data):\s*)+/i, '');
  if (detail.includes('ambiguous atlas key')) {
    return {
      message: 'These labels are not unique in this atlas. Use atlas IDs or full source labels.',
      detail,
    };
  }
  return { message: detail };
}
