import { describe, expect, it } from 'vitest';
import { TauriTransport } from '../transport';

describe('TauriTransport analysis command namespacing', () => {
  it('routes analysis commands through the api-bridge namespace', () => {
    const transport = new TauriTransport() as TauriTransport & {
      getNamespacedCommand: (cmd: string) => string;
    };

    expect(transport.getNamespacedCommand('list_analyses')).toBe(
      'plugin:api-bridge|list_analyses'
    );
    expect(transport.getNamespacedCommand('start_analysis')).toBe(
      'plugin:api-bridge|start_analysis'
    );
  });
});
