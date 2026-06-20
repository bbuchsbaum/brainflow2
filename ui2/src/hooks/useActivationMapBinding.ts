/**
 * useActivationMapBinding
 *
 * React lifecycle wrapper around {@link startActivationMapBinding}. Mount this
 * wherever a view depends on a volume layer and its projected surface overlay
 * staying visually in sync (e.g. the hybrid surface/volume workspace). The
 * binding is ref-counted, so mounting it from several places is safe.
 */

import { useEffect } from 'react';
import { startActivationMapBinding } from '@/services/ActivationMapBinding';

export function useActivationMapBinding(): void {
  useEffect(() => {
    const stop = startActivationMapBinding();
    return stop;
  }, []);
}
