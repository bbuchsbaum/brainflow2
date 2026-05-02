import { describe, expect, it } from 'vitest';
import { TauriTransport } from '../transport';

describe('TauriTransport timeseries command namespacing', () => {
  it('routes sample_voxel_timeseries through the api-bridge namespace', () => {
    const transport = new TauriTransport() as TauriTransport & {
      getNamespacedCommand: (cmd: string) => string;
    };

    expect(transport.getNamespacedCommand('sample_voxel_timeseries')).toBe(
      'plugin:api-bridge|sample_voxel_timeseries'
    );
  });
});
