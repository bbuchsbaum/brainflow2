import { describe, expect, it } from 'vitest';
import {
  parcelBindingMessage,
  parcelMetricColumns,
  suggestParcelIdColumn,
} from '../parcelTablePresentation';

describe('parcel table suggestions', () => {
  it('recognizes a unique ID header without inferring identity from index or row order', () => {
    expect(suggestParcelIdColumn(['roi_id', 'linear', 'quadratic', 'cubic'])).toBe('roi_id');
    expect(suggestParcelIdColumn(['ROI_ID', 'beta'])).toBe('ROI_ID');
    expect(suggestParcelIdColumn(['index', 'beta'])).toBeNull();
    expect(suggestParcelIdColumn(['atlas_id', 'beta'])).toBeNull();
    expect(suggestParcelIdColumn(['id', 'roi_id', 'beta'])).toBeNull();
  });
  it('does not offer identifiers or mapping fields as display metrics', () => {
    const columns = ['roi_id', 'linear', 'quadratic', 'cubic', 'network'].map((name) => ({
      name,
      range: [1, 400] as [number, number],
      finiteCount: 400,
      missingCount: 0,
      error: null,
    }));
    expect(parcelMetricColumns(columns, ['linear', 'network']).map((c) => c.name)).toEqual([
      'quadratic',
      'cubic',
    ]);
  });
  it('explains ambiguous labels and retains the exact diagnostic for inspection', () => {
    const detail = 'ambiguous atlas key LabelHemisphere("OFC_1", Left); use an ID';
    expect(parcelBindingMessage(`Invalid Input: Invalid data: ${detail}`)).toEqual({
      message: 'These labels are not unique in this atlas. Use atlas IDs or full source labels.',
      detail,
    });
    expect(parcelBindingMessage('Invalid Input: Row 12: unknown atlas key 99')).toEqual({
      message: 'Row 12: unknown atlas key 99',
    });
  });
});
