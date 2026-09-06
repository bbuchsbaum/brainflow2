import raw from '../../../../core/field_table/src/population_inference/methods.json?raw';
import type { PopulationInferenceSpec } from '@/types/population';

export interface InferenceMethod {
  id: PopulationInferenceSpec['method'];
  version: number;
  label: string;
  inputs: 'onePopulation' | 'independentGroups';
  description: string;
  estimand: string;
  limitations: string;
  acceptedRoles: PopulationInferenceSpec['role'][];
  minimumParticipants: number;
  defaultChannel: PopulationInferenceSpec['channel'];
  channels: {
    id: PopulationInferenceSpec['channel'];
    label: string;
    scale: 'effect' | 'diverging' | 'nonnegative';
    artifact: string;
    initialLimit?: number;
    countPopulation?: 'A' | 'B';
  }[];
}
/** Same built-in descriptor bytes as Rust. Unknown methods never select a fallback. */
export const inferenceMethods = JSON.parse(raw) as readonly InferenceMethod[];
export function inferenceMethod(method: PopulationInferenceSpec['method']): InferenceMethod {
  const descriptor = inferenceMethods.find((d) => d.id === method);
  if (!descriptor) throw new Error(`Unsupported statistical method: ${method}`);
  return descriptor;
}
export function inferenceChannel(spec: PopulationInferenceSpec) {
  const channel = inferenceMethod(spec.method).channels.find((c) => c.id === spec.channel);
  if (!channel) throw new Error('The selected channel is not produced by this statistical method.');
  return channel;
}
export function inferenceChannelNames(method: PopulationInferenceSpec['method']) {
  return Object.fromEntries(inferenceMethod(method).channels.map((c) => [c.id, c.label]));
}
export function inferenceActive(spec: PopulationInferenceSpec | null, arrangement: string) {
  return !!spec && !['groups', 'comparison', 'difference'].includes(arrangement);
}
