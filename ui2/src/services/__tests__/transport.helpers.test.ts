import { describe, expect, it } from 'vitest';
import { TauriTransport } from '../transport';

describe('TauriTransport helper command namespacing', () => {
  it('routes reusable API helper commands through the api-bridge namespace', () => {
    const transport = new TauriTransport() as TauriTransport & {
      getNamespacedCommand: (cmd: string) => string;
    };

    expect(transport.getNamespacedCommand('set_layer_border')).toBe(
      'plugin:api-bridge|set_layer_border'
    );
    expect(transport.getNamespacedCommand('sample_layer_value_at_world')).toBe(
      'plugin:api-bridge|sample_layer_value_at_world'
    );
  });
});
