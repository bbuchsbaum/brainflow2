import type {
  BidsMedianSliceImage,
  BidsRunRecord,
  BidsSliceImage,
  BidsSliceRequest,
} from '@brainflow/api';
import { getTransport } from '@/services/transport';

/** A dangling annex link is a present run with no header and no bytes. */
export const isImageUnavailable = (run: BidsRunRecord) => run.header === null && run.size_bytes === 0;

export function sliceKind(run: BidsRunRecord): string {
  if (run.datatype === 'anat') return 'anat';
  return run.suffix === 'bold' ? 'mean' : 'first';
}

export function formatZ(mm: number | null): string {
  if (mm === null) return '';
  const rounded = Math.round(mm);
  return `z ${rounded > 0 ? '+' : ''}${rounded} mm`;
}

export function fetchSlice(request: BidsSliceRequest): Promise<BidsSliceImage> {
  return getTransport().invoke<BidsSliceImage>('get_bids_slice', { request });
}

export function fetchMedianSlice(
  paths: string[],
  request: BidsSliceRequest,
): Promise<BidsMedianSliceImage> {
  return getTransport().invoke<BidsMedianSliceImage>('get_bids_median_slice', { paths, request });
}
