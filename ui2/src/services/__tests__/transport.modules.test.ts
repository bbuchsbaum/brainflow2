import { describe, expect, it } from 'vitest';
import { BRIDGE_MODULES } from '@brainflow/api';
import { MockTransport } from '../transport';

describe('MockTransport bridge modules', () => {
  it('lists the bridge modules, all enabled at start, like the bridge', async () => {
    const transport = new MockTransport();
    const infos = await transport.invoke<Array<{ id: string; enabled: boolean }>>('list_modules');
    expect(infos.map((i) => i.id)).toEqual(Object.keys(BRIDGE_MODULES));
    expect(infos.every((i) => i.enabled)).toBe(true);
  });

  it('enables exactly the listed modules; a disabled module’s commands reject', async () => {
    const transport = new MockTransport();
    transport.setMockResponse('list_analyses', []);
    const infos = await transport.invoke<Array<{ id: string; enabled: boolean }>>('set_enabled_modules', {
      moduleIds: [],
    });
    expect(infos.find((i) => i.id === 'analysis')?.enabled).toBe(false);
    await expect(transport.invoke('list_analyses')).rejects.toEqual({
      ModuleDisabled: { code: 12001, module: 'analysis' },
    });
    await transport.invoke('set_enabled_modules', { moduleIds: ['analysis'] });
    await expect(transport.invoke('list_analyses')).resolves.toEqual([]);
  });

  it('rejects unknown module ids without changing anything', async () => {
    const transport = new MockTransport();
    await expect(transport.invoke('set_enabled_modules', { moduleIds: ['nope'] })).rejects.toMatchObject({
      Input: { code: 12002 },
    });
    const infos = await transport.invoke<Array<{ enabled: boolean }>>('list_modules');
    expect(infos.every((i) => i.enabled)).toBe(true);
  });
});
