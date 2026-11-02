import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerModuleKeybinding, type ContextHost } from '@/modules/context';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

let service: ReturnType<typeof getKeyboardShortcutService> | null = null;
afterEach(() => { service?.destroy(); service = null; });

describe('view-mode module shortcut precedence', () => {
  it('outranks core only while its view mode is active, then falls back after disposal', async () => {
    service = getKeyboardShortcutService(); service.destroy(); service.init();
    let mode = 'segmentation.segment'; const core = vi.fn(); const module = vi.fn(async () => true);
    const host: ContextHost = { moduleId: 'segmentation', moduleTitle: 'Segmentation', stage: 'experimental', commands: new Map([['segmentation.brush', 'Brush']]), workspaces: new Set(), isEnabled: () => true, matchesWhen: (when) => when?.viewMode === mode, executeCommand: module, openWorkspace: async () => null };
    service.register({ id: 'core.b', key: 'b', category: 'Core', description: 'Core B', handler: core });
    const dispose = registerModuleKeybinding(host, { command: 'segmentation.brush', key: 'b', when: { viewMode: 'segmentation.segment' } }, 'runtime');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })); await Promise.resolve();
    expect(module).toHaveBeenCalledTimes(1); expect(core).not.toHaveBeenCalled();
    mode = 'mosaic'; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(core).toHaveBeenCalledTimes(1); expect(module).toHaveBeenCalledTimes(1);
    mode = 'segmentation.segment'; dispose(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(core).toHaveBeenCalledTimes(2); expect(module).toHaveBeenCalledTimes(1);
  });
});
