import { VolumeHandle } from '@brainflow/api';
export declare class NeuroAtlas {
    static loadSchaeferAtlas(): Promise<{
        volume: VolumeHandle;
        labels: string[];
        colors: number[][];
    }>;
}
