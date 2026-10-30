import type { NiftiHeaderInfo } from '@/services/apiService';
import { displayMinus } from '@/utils/valueFormat';

export interface HeaderFact {
  label: string;
  value: string;
}

/** A header float at f32 precision ("0.1", not "0.10000000149"). */
function headerFloat(value: number): string {
  return displayMinus(String(Number.parseFloat(value.toPrecision(7))));
}

/** Storage facts: the file's own datatype and scaling, then the in-memory type
 * (scaled integers are held as f32). Without a re-readable
 * header only the in-memory type is known. */
export function storageFacts(info: Pick<NiftiHeaderInfo, 'data_type' | 'storage'>): HeaderFact[] {
  const storage = info.storage;
  if (!storage) return [{ label: 'Data type', value: info.data_type }];
  const facts: HeaderFact[] = [
    { label: 'Data type', value: storage.datatype },
    { label: 'Bits per voxel', value: String(storage.bitpix) },
    { label: 'Loaded as', value: info.data_type },
    {
      label: 'Scale slope',
      value: storage.scl_slope === 0 ? '0 (no scaling)' : headerFloat(storage.scl_slope),
    },
    { label: 'Scale intercept', value: headerFloat(storage.scl_inter) },
  ];
  if (storage.cal_min !== 0 || storage.cal_max !== 0)
    facts.push({
      label: 'Calibration',
      value: `${headerFloat(storage.cal_min)} to ${headerFloat(storage.cal_max)}`,
    });
  return facts;
}
