import { populationProbeController } from '@/services/studio/PopulationProbeController';
import { PopulationProbePanel } from './PopulationProbePanel';

/**
 * The Values dock tab: the Studio's one probe controller. The pin is shared by
 * every lens, so the tab also samples it while Deck or Compare is in front
 * (the centre drives it only in Population); the two drivers share the
 * controller, which samples while either holds it.
 */
export default function PopulationValuesTab() {
  return <PopulationProbePanel controller={populationProbeController} drive reportsDockHeight />;
}
